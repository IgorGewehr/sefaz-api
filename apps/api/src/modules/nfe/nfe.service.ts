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
import { SoapClientService, XmlSignerService, getNFeEndpoints } from '@app/sefaz';
import {
  buildEventoCancelamentoXml,
  buildEventoCCeXml,
  buildNfeProcEnvelope,
  buildNFeXml,
  gerarCodigoNumerico,
  gerarIdLote,
  montarChaveAcesso,
  parseRetAutorizacao,
  parseRetEvento,
  SOAP_ACTION_AUTORIZACAO,
  SOAP_ACTION_EVENTO,
  SOAP_ACTION_RET_AUTORIZACAO,
  UF_CODES,
  validateNFePayload,
  wrapConsReciNFe,
  wrapEnviNFe,
  wrapEventoSoap,
  type NFeRequest,
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

const POLLING_MAX_ATTEMPTS = 10;
const POLLING_INTERVAL_MS = 3_000;

/**
 * NFe orchestration. End-to-end:
 *   validate → resolve cert → build XML → sign → enviNFe → SOAP send →
 *   parse retorno (and poll retAutorizacao if processando) → persist final
 *   status with `nfeProc` envelope in storage → audit + dispatch webhook.
 *
 * The cert is decrypted from KMS only for the duration of the call. The
 * Invoice row goes through PROCESSING → AUTHORIZED|REJECTED|DENIED.
 */
@Injectable()
export class NfeService {
  private readonly logger = new Logger(NfeService.name);
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
    const request = payload as unknown as NFeRequest;
    const errors = validateNFePayload(request);
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
      modelo: '55',
      serie: request.serie ?? '1',
      numero: request.numero,
      tipoEmissao: '1',
      codigoNumerico: cNF,
      uf: ufEmitente,
    });

    const xml = buildNFeXml(request, chaveAcesso, request.numero, tpAmb, this.respTec);

    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso, kind: 'NFE_EMIT' },
    });
    const signedXml = this.signer.signEnvelope(xml, decrypted, 'infNFe');

    const invoice = await this.prisma.asPrivileged().invoice.create({
      data: {
        tenantId: ctx.tenantId,
        type: InvoiceType.NFE,
        status: InvoiceStatus.PROCESSING,
        series: parseInt(request.serie ?? '1', 10),
        number: request.numero,
        accessKey: chaveAcesso,
        environment: ambiente,
        ufEmitter: ufEmitente,
        issuer: request.emitente as unknown as Prisma.InputJsonValue,
        recipient: request.destinatario as unknown as Prisma.InputJsonValue,
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

    const endpoints = getNFeEndpoints(ufEmitente, ambiente === 'PRODUCTION' ? 'producao' : 'homologacao');

    let resultado: SefazResponse;
    try {
      const soapBody = wrapEnviNFe(signedXml, gerarIdLote(), '1');
      const soapResponse = await this.soap.send(
        endpoints.autorizacao,
        SOAP_ACTION_AUTORIZACAO,
        soapBody,
        decrypted,
      );
      resultado = await this.parseAndMaybePoll(soapResponse, ufEmitente, ambiente, decrypted);
    } catch (err) {
      await this.audit.record('INVOICE_EMIT', {
        tenantId: ctx.tenantId,
        resourceId: invoice.id,
        metadata: { type: InvoiceType.NFE, accessKey: chaveAcesso, error: (err as Error).message },
      });
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
        receipt: resultado.nRec ?? null,
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
        type: InvoiceType.NFE,
        accessKey,
        status: finalStatus,
        cStat: resultado.codigoStatus,
        protocolo: resultado.protocolo,
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
      throw new BadRequestException('Invoice sem accessKey/protocolo — emissão não autorizada');
    }
    if (reason.length < 15 || reason.length > 255) {
      throw new BadRequestException('Justificativa deve ter entre 15 e 255 caracteres');
    }

    const ambiente = invoice.environment;
    const tpAmb = ambiente === 'PRODUCTION' ? '1' : '2';
    const cert = await this.certs.resolveForEmitter(
      ctx.tenantId,
      (invoice.issuer as { cnpj?: string } | null)?.cnpj ?? '',
    );
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso: invoice.accessKey, kind: 'NFE_CANCEL' },
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

    const endpoints = getNFeEndpoints(
      invoice.ufEmitter,
      ambiente === 'PRODUCTION' ? 'producao' : 'homologacao',
    );

    const soapResponse = await this.soap.send(
      endpoints.recepcaoEvento,
      SOAP_ACTION_EVENTO,
      soapBody,
      decrypted,
    );
    const retorno = this.soap.parseEnvelopeBody(soapResponse);
    const resultado = parseRetEvento(unwrapEventoMsg(retorno), invoice.accessKey);

    if (resultado.success) {
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

    throw new SefazError(`Cancelamento rejeitado: ${resultado.motivoStatus}`, {
      cStat: resultado.codigoStatus,
    });
  }

  async cartaCorrecao(
    ctx: { tenantId: string },
    invoice: Invoice,
    correcao: string,
    sequencia = 1,
  ): Promise<SefazResponse> {
    if (!invoice.accessKey) throw new BadRequestException('Invoice sem accessKey');
    if (correcao.length < 15 || correcao.length > 1000) {
      throw new BadRequestException('Correção deve ter entre 15 e 1000 caracteres');
    }
    const tpAmb = invoice.environment === 'PRODUCTION' ? '1' : '2';
    const cert = await this.certs.resolveForEmitter(
      ctx.tenantId,
      (invoice.issuer as { cnpj?: string } | null)?.cnpj ?? '',
    );
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso: invoice.accessKey, kind: 'NFE_CCE' },
    });

    const eventoXml = buildEventoCCeXml({
      chaveAcesso: invoice.accessKey,
      correcao,
      sequencia,
      ufEmitente: invoice.ufEmitter,
      tpAmb,
      loteId: gerarIdLote(),
    });
    const signed = this.signer.signEvent(eventoXml, decrypted);
    const soapBody = wrapEventoSoap(signed);
    const endpoints = getNFeEndpoints(
      invoice.ufEmitter,
      invoice.environment === 'PRODUCTION' ? 'producao' : 'homologacao',
    );
    const soapResponse = await this.soap.send(
      endpoints.recepcaoEvento,
      SOAP_ACTION_EVENTO,
      soapBody,
      decrypted,
    );
    const retorno = this.soap.parseEnvelopeBody(soapResponse);
    return parseRetEvento(unwrapEventoMsg(retorno), invoice.accessKey);
  }

  private async parseAndMaybePoll(
    soapResponse: string,
    ufEmitente: string,
    ambiente: Environment,
    cert: { pfxBase64: string; password: string },
  ): Promise<SefazResponse> {
    const retorno = unwrapEventoMsg(this.soap.parseEnvelopeBody(soapResponse));
    let resultado = parseRetAutorizacao(retorno);
    if (resultado.status !== 'processando' || !resultado.nRec) return resultado;

    const tpAmb = ambiente === 'PRODUCTION' ? '1' : '2';
    const endpoints = getNFeEndpoints(ufEmitente, ambiente === 'PRODUCTION' ? 'producao' : 'homologacao');
    const nRec = resultado.nRec;
    for (let i = 0; i < POLLING_MAX_ATTEMPTS; i++) {
      await sleep(POLLING_INTERVAL_MS);
      try {
        const body = wrapConsReciNFe(nRec, tpAmb);
        const res = await this.soap.send(
          endpoints.retAutorizacao,
          SOAP_ACTION_RET_AUTORIZACAO,
          body,
          cert,
        );
        const r = parseRetAutorizacao(unwrapEventoMsg(this.soap.parseEnvelopeBody(res)));
        if (r.status !== 'processando') return r;
        resultado = r;
      } catch (err) {
        if (i === POLLING_MAX_ATTEMPTS - 1) {
          this.logger.warn(`retAutorizacao polling failed after ${i + 1} attempts: ${(err as Error).message}`);
          return resultado;
        }
      }
    }
    return resultado;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SOAP Body comes back wrapped in an outer message element (e.g. nfeResultMsg).
 * Walk one level deep to surface the actual ret* envelope. Idempotent on
 * envelopes that don't have a wrapper.
 */
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
