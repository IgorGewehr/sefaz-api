import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Environment,
  Invoice,
  InvoiceStatus,
  InvoiceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@app/database';
import { StorageService } from '@app/storage';
import { SoapClientService, XmlSignerService, getNFCeEndpoints } from '@app/sefaz';
import {
  buildEventoCancelamentoXml,
  buildNFCeSupl,
  buildNFCeXml,
  buildNfeProcEnvelope,
  gerarCodigoNumerico,
  gerarIdLote,
  montarChaveAcesso,
  parseRetAutorizacao,
  parseRetEvento,
  SOAP_ACTION_AUTORIZACAO,
  SOAP_ACTION_EVENTO,
  UF_CODES,
  validateNFCePayload,
  wrapEnviNFe,
  wrapEventoSoap,
  type NFCeRequest,
  type RespTec,
  type SefazResponse,
} from '@app/fiscal-core';
import { SefazError } from '@app/common';
import { CertificateService } from '../certificate/certificate.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';

interface EmitContext {
  tenantId: string;
  idempotencyKey?: string;
}

/**
 * NFCe orchestration. NFCe is *always* synchronous (indSinc=1) — the PDV
 * cannot wait for retAutorizacao polling, so SEFAZ inlines the protNFe in
 * the same response. Flow:
 *
 *   validate → build XML → sign with infNFe → splice <infNFeSupl> with QR
 *   Code in front of <Signature> → wrap enviNFe(indSinc=1) → SOAP → parse
 *   protNFe directly. Persists Invoice + signed XML + nfeProc envelope.
 */
@Injectable()
export class NfceService {
  private readonly logger = new Logger(NfceService.name);
  private readonly respTec: RespTec;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly soap: SoapClientService,
    private readonly signer: XmlSignerService,
    private readonly certs: CertificateService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookService,
    private readonly config: ConfigService,
  ) {
    this.respTec = {
      cnpj: this.config.getOrThrow<string>('RESP_TEC_CNPJ'),
      contato: this.config.getOrThrow<string>('RESP_TEC_CONTATO'),
      email: this.config.getOrThrow<string>('RESP_TEC_EMAIL'),
      fone: this.config.getOrThrow<string>('RESP_TEC_FONE'),
    };
  }

  async emit(ctx: EmitContext, payload: Record<string, unknown>): Promise<Invoice> {
    const request = payload as unknown as NFCeRequest;
    const errors = validateNFCePayload(request);
    if (errors.length > 0) throw new BadRequestException({ code: 'invalid_payload', errors });

    const ufEmitente = request.ufEmitente.toUpperCase();
    const cUF = UF_CODES[ufEmitente];
    if (!cUF) throw new BadRequestException(`UF inválida: ${request.ufEmitente}`);

    const cert = await this.certs.resolveForEmitter(ctx.tenantId, request.emitente.cnpj);
    const ambiente: Environment =
      request.ambiente === 'producao' ? 'PRODUCTION' : 'HOMOLOGATION';
    const tpAmb = ambiente === 'PRODUCTION' ? '1' : '2';

    const cNF = gerarCodigoNumerico();
    const chaveAcesso = montarChaveAcesso({
      cUF,
      dataEmissao: new Date(),
      cnpj: request.emitente.cnpj,
      modelo: '65',
      serie: request.serie ?? '1',
      numero: request.numero,
      tipoEmissao: '1',
      codigoNumerico: cNF,
      uf: ufEmitente,
    });

    const baseXml = buildNFCeXml(request, chaveAcesso, request.numero, tpAmb, this.respTec);
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso, kind: 'NFCE_EMIT' },
    });
    let signedXml = this.signer.signEnvelope(baseXml, decrypted, 'infNFe');

    // QR Code suplementar entra entre </infNFe> e <Signature> (XSD requirement).
    const supl = buildNFCeSupl(chaveAcesso, tpAmb, request.csc, ufEmitente);
    signedXml = signedXml.replace('<Signature', `${supl}<Signature`);

    const invoice = await this.prisma.asPrivileged().invoice.create({
      data: {
        tenantId: ctx.tenantId,
        type: InvoiceType.NFCE,
        status: InvoiceStatus.PROCESSING,
        series: parseInt(request.serie ?? '1', 10),
        number: request.numero,
        accessKey: chaveAcesso,
        environment: ambiente,
        ufEmitter: ufEmitente,
        issuer: request.emitente as unknown as Prisma.InputJsonValue,
        recipient: (request.consumidor ?? {}) as unknown as Prisma.InputJsonValue,
        items: request.itens as unknown as Prisma.InputJsonValue,
        totals: {} as Prisma.InputJsonValue,
        payment: request.pagamento as unknown as Prisma.InputJsonValue,
        idempotencyKey: ctx.idempotencyKey,
      },
    });

    const signedKey = StorageService.keyFor({
      tenantId: ctx.tenantId,
      invoiceId: invoice.id,
      kind: 'signed-xml',
    });
    await this.storage.put(signedKey, Buffer.from(signedXml, 'utf8'), 'application/xml');

    const endpoints = getNFCeEndpoints(ufEmitente, ambiente === 'PRODUCTION' ? 'producao' : 'homologacao');

    let resultado: SefazResponse;
    try {
      const soapBody = wrapEnviNFe(signedXml, gerarIdLote(), '1');
      const soapResponse = await this.soap.send(
        endpoints.autorizacao,
        SOAP_ACTION_AUTORIZACAO,
        soapBody,
        decrypted,
      );
      const retorno = unwrapEventoMsg(this.soap.parseEnvelopeBody(soapResponse));
      resultado = parseRetAutorizacao(retorno);
    } catch (err) {
      await this.prisma.asPrivileged().invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.REJECTED,
          statusMessage: `SEFAZ unreachable: ${(err as Error).message}`,
          signedXmlStoragePath: signedKey,
        },
      });
      throw new SefazError((err as Error).message);
    }

    const finalStatus = mapSefazStatus(resultado.status);
    const accessKey = resultado.chaveAcesso ?? chaveAcesso;
    const proc = resultado.success ? buildNfeProcEnvelope(signedXml, { ...resultado, chaveAcesso: accessKey }, tpAmb) : undefined;

    let procKey: string | undefined;
    if (proc) {
      procKey = StorageService.keyFor({ tenantId: ctx.tenantId, invoiceId: invoice.id, kind: 'xml' });
      await this.storage.put(procKey, Buffer.from(proc, 'utf8'), 'application/xml');
    }

    const updated = await this.prisma.asPrivileged().invoice.update({
      where: { id: invoice.id },
      data: {
        status: finalStatus,
        statusMessage: `${resultado.codigoStatus}: ${resultado.motivoStatus}`,
        protocol: resultado.protocolo ?? null,
        accessKey,
        signedXmlStoragePath: signedKey,
        xmlStoragePath: procKey ?? null,
        authorizedAt: resultado.success ? new Date(resultado.dataRecebimento || Date.now()) : null,
      },
    });

    await this.audit.record('INVOICE_EMIT', {
      tenantId: ctx.tenantId,
      resourceId: invoice.id,
      metadata: {
        type: InvoiceType.NFCE,
        accessKey,
        status: finalStatus,
        cStat: resultado.codigoStatus,
      },
    });

    if (finalStatus === InvoiceStatus.AUTHORIZED) {
      await this.webhooks.dispatch(ctx.tenantId, 'INVOICE_AUTHORIZED', {
        invoiceId: invoice.id,
        accessKey,
        protocol: resultado.protocolo,
      } as Prisma.InputJsonValue);
    } else if (finalStatus === InvoiceStatus.REJECTED || finalStatus === InvoiceStatus.DENIED) {
      await this.webhooks.dispatch(ctx.tenantId, 'INVOICE_REJECTED', {
        invoiceId: invoice.id,
        accessKey,
        cStat: resultado.codigoStatus,
        motivo: resultado.motivoStatus,
      } as Prisma.InputJsonValue);
    }

    return updated;
  }

  async cancel(
    ctx: { tenantId: string },
    invoice: Invoice,
    reason: string,
  ): Promise<Invoice> {
    if (!invoice.accessKey || !invoice.protocol) {
      throw new BadRequestException('Invoice sem accessKey/protocolo');
    }
    if (reason.length < 15 || reason.length > 255) {
      throw new BadRequestException('Justificativa deve ter entre 15 e 255 caracteres');
    }
    const tpAmb = invoice.environment === 'PRODUCTION' ? '1' : '2';
    const cert = await this.certs.resolveForEmitter(
      ctx.tenantId,
      (invoice.issuer as { cnpj?: string } | null)?.cnpj ?? '',
    );
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso: invoice.accessKey, kind: 'NFCE_CANCEL' },
    });

    const eventoXml = buildEventoCancelamentoXml({
      chaveAcesso: invoice.accessKey,
      protocolo: invoice.protocol,
      justificativa: reason,
      ufEmitente: invoice.ufEmitter,
      tpAmb,
      loteId: gerarIdLote(),
    });
    const signed = this.signer.signEvent(eventoXml, decrypted);
    const soapBody = wrapEventoSoap(signed);

    const endpoints = getNFCeEndpoints(
      invoice.ufEmitter,
      invoice.environment === 'PRODUCTION' ? 'producao' : 'homologacao',
    );
    const soapResponse = await this.soap.send(
      endpoints.recepcaoEvento,
      SOAP_ACTION_EVENTO,
      soapBody,
      decrypted,
    );
    const retorno = unwrapEventoMsg(this.soap.parseEnvelopeBody(soapResponse));
    const resultado = parseRetEvento(retorno, invoice.accessKey);

    if (!resultado.success) {
      throw new SefazError(`Cancelamento NFCe rejeitado: ${resultado.motivoStatus}`, {
        cStat: resultado.codigoStatus,
      });
    }

    const cancelKey = StorageService.keyFor({
      tenantId: ctx.tenantId,
      invoiceId: invoice.id,
      kind: 'cancel-xml',
    });
    await this.storage.put(cancelKey, Buffer.from(signed, 'utf8'), 'application/xml');
    await this.audit.record('INVOICE_CANCEL', {
      tenantId: ctx.tenantId,
      resourceId: invoice.id,
      metadata: { protocolo: resultado.protocolo },
    });
    const updated = await this.prisma.asPrivileged().invoice.update({
      where: { id: invoice.id },
      data: {
        status: InvoiceStatus.CANCELLED,
        statusMessage: `${resultado.codigoStatus}: ${resultado.motivoStatus}`,
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelXmlPath: cancelKey,
      },
    });
    await this.webhooks.dispatch(ctx.tenantId, 'INVOICE_CANCELLED', {
      invoiceId: invoice.id,
      accessKey: invoice.accessKey,
      protocol: resultado.protocolo,
    } as Prisma.InputJsonValue);
    return updated;
  }
}

function unwrapEventoMsg(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const inner = obj[key];
    if (
      inner &&
      typeof inner === 'object' &&
      ('cStat' in (inner as object) ||
        'protNFe' in (inner as object) ||
        'retEvento' in (inner as object) ||
        'infRec' in (inner as object))
    ) {
      return inner;
    }
  }
  return body;
}

function mapSefazStatus(s: SefazResponse['status']): InvoiceStatus {
  switch (s) {
    case 'autorizado':
      return InvoiceStatus.AUTHORIZED;
    case 'rejeitado':
      return InvoiceStatus.REJECTED;
    case 'denegado':
      return InvoiceStatus.DENIED;
    case 'cancelado':
      return InvoiceStatus.CANCELLED;
    case 'processando':
      return InvoiceStatus.PROCESSING;
    default:
      return InvoiceStatus.REJECTED;
  }
}
