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
import { SoapClientService, XmlSignerService, getMDFeEndpoints } from '@app/sefaz';
import {
  buildMdfeConsSit,
  buildMdfeEventoCancelamento,
  buildMdfeEventoEncerramento,
  buildMdfeXml,
  gerarCodigoNumerico,
  montarChaveAcesso,
  parseMdfeConsultaRetorno,
  parseMdfeEventoRetorno,
  parseMdfeRetorno,
  SOAP_ACTION_MDFE_CONSULTA,
  SOAP_ACTION_MDFE_EVENTO,
  SOAP_ACTION_MDFE_RECEPCAO,
  UF_CODES,
  wrapMdfeConsulta,
  wrapMdfeEvento,
  wrapMdfeRecepcaoSinc,
  type MdfeRequest,
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
 * MDF-e (Manifesto Eletrônico) orchestration. The recepção is synchronous —
 * MDFeRecepcaoSinc returns a final retMDFe in the same response. Lifecycle
 * after authorization includes encerramento (110112) when the cargo is
 * delivered and cancelamento (110111) before any transit. We persist the
 * Invoice row with type=MDFE and reuse the same status flow as NFe.
 */
@Injectable()
export class MdfeService {
  private readonly logger = new Logger(MdfeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly soap: SoapClientService,
    private readonly signer: XmlSignerService,
    private readonly certs: CertificateService,
    private readonly audit: AuditService,
    private readonly webhooks: WebhookService,
    private readonly _config: ConfigService,
  ) {}

  async emit(ctx: EmitContext, payload: Record<string, unknown>): Promise<Invoice> {
    const request = payload as unknown as MdfeRequest;
    if (!request.numero) throw new BadRequestException('numero é obrigatório');
    if (!request.ufInicio) throw new BadRequestException('ufInicio é obrigatório');
    const cUF = UF_CODES[request.ufInicio.toUpperCase()];
    if (!cUF) throw new BadRequestException(`UF inválida: ${request.ufInicio}`);

    const cert = await this.certs.resolveForEmitter(ctx.tenantId, request.emitente.cnpj);
    const ambiente: Environment =
      request.ambiente === 'producao' ? 'PRODUCTION' : 'HOMOLOGATION';
    const tpAmb = ambiente === 'PRODUCTION' ? '1' : '2';

    const cNF = gerarCodigoNumerico();
    const chaveAcesso = montarChaveAcesso({
      cUF,
      dataEmissao: new Date(),
      cnpj: request.emitente.cnpj,
      modelo: '58',
      serie: request.serie ?? '1',
      numero: request.numero,
      tipoEmissao: '1',
      codigoNumerico: cNF,
      uf: request.ufInicio,
    });

    const xml = buildMdfeXml(request, chaveAcesso, request.numero, tpAmb);
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso, kind: 'MDFE_EMIT' },
    });
    const signedXml = this.signer.signEnvelope(xml, decrypted, 'infMDFe');

    const invoice = await this.prisma.asPrivileged().invoice.create({
      data: {
        tenantId: ctx.tenantId,
        type: InvoiceType.MDFE,
        status: InvoiceStatus.PROCESSING,
        series: parseInt(request.serie ?? '1', 10),
        number: request.numero,
        accessKey: chaveAcesso,
        environment: ambiente,
        ufEmitter: request.ufInicio.toUpperCase(),
        issuer: request.emitente as unknown as Prisma.InputJsonValue,
        recipient: { tipo: 'mdfe', ufFim: request.ufFim } as unknown as Prisma.InputJsonValue,
        items: (request.descargas ?? []) as unknown as Prisma.InputJsonValue,
        totals: {
          valorTotalCarga: request.valorTotalCarga,
          pesoBrutoTotal: request.pesoBrutoTotal,
        } as unknown as Prisma.InputJsonValue,
        idempotencyKey: ctx.idempotencyKey,
      },
    });

    const signedKey = StorageService.keyFor({
      tenantId: ctx.tenantId,
      invoiceId: invoice.id,
      kind: 'signed-xml',
    });
    await this.storage.put(signedKey, Buffer.from(signedXml, 'utf8'), 'application/xml');

    const endpoints = getMDFeEndpoints(ambiente === 'PRODUCTION' ? 'producao' : 'homologacao');

    let resultado: SefazResponse;
    try {
      const soapBody = wrapMdfeRecepcaoSinc(signedXml);
      const soapResponse = await this.soap.send(
        endpoints.recepcao,
        SOAP_ACTION_MDFE_RECEPCAO,
        soapBody,
        decrypted,
      );
      const retorno = unwrapMdfeMsg(this.soap.parseEnvelopeBody(soapResponse));
      resultado = parseMdfeRetorno(retorno, chaveAcesso);
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
    const updated = await this.prisma.asPrivileged().invoice.update({
      where: { id: invoice.id },
      data: {
        status: finalStatus,
        statusMessage: `${resultado.codigoStatus}: ${resultado.motivoStatus}`,
        protocol: resultado.protocolo ?? null,
        signedXmlStoragePath: signedKey,
        authorizedAt: resultado.success ? new Date(resultado.dataRecebimento || Date.now()) : null,
      },
    });

    await this.audit.record('INVOICE_EMIT', {
      tenantId: ctx.tenantId,
      resourceId: invoice.id,
      metadata: {
        type: InvoiceType.MDFE,
        accessKey: chaveAcesso,
        cStat: resultado.codigoStatus,
      },
    });

    if (finalStatus === InvoiceStatus.AUTHORIZED) {
      await this.webhooks.dispatch(ctx.tenantId, 'INVOICE_AUTHORIZED', {
        invoiceId: invoice.id,
        accessKey: chaveAcesso,
        protocol: resultado.protocolo,
      } as Prisma.InputJsonValue);
    } else if (finalStatus === InvoiceStatus.REJECTED || finalStatus === InvoiceStatus.DENIED) {
      await this.webhooks.dispatch(ctx.tenantId, 'INVOICE_REJECTED', {
        invoiceId: invoice.id,
        accessKey: chaveAcesso,
        cStat: resultado.codigoStatus,
        motivo: resultado.motivoStatus,
      } as Prisma.InputJsonValue);
    }
    return updated;
  }

  async cancel(ctx: { tenantId: string }, invoice: Invoice, reason: string): Promise<Invoice> {
    if (!invoice.accessKey || !invoice.protocol) {
      throw new BadRequestException('MDF-e sem accessKey/protocolo — não pode ser cancelado');
    }
    if (reason.length < 15 || reason.length > 255) {
      throw new BadRequestException('Justificativa deve ter entre 15 e 255 caracteres');
    }
    const cnpj = invoice.accessKey.substring(6, 20);
    const tpAmb = invoice.environment === 'PRODUCTION' ? '1' : '2';
    const cert = await this.certs.resolveForEmitter(ctx.tenantId, cnpj);
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso: invoice.accessKey, kind: 'MDFE_CANCEL' },
    });

    const eventoXml = buildMdfeEventoCancelamento({
      chaveAcesso: invoice.accessKey,
      cnpj,
      protocolo: invoice.protocol,
      justificativa: reason,
      tpAmb,
    });
    const signed = this.signer.signEvent(eventoXml, decrypted);
    const soapBody = wrapMdfeEvento(signed);

    const endpoints = getMDFeEndpoints(invoice.environment === 'PRODUCTION' ? 'producao' : 'homologacao');
    const soapResponse = await this.soap.send(
      endpoints.recepcaoEvento,
      SOAP_ACTION_MDFE_EVENTO,
      soapBody,
      decrypted,
    );
    const retorno = unwrapMdfeMsg(this.soap.parseEnvelopeBody(soapResponse));
    const resultado = parseMdfeEventoRetorno(retorno, invoice.accessKey);
    if (!resultado.success) {
      throw new SefazError(`Cancelamento MDF-e rejeitado: ${resultado.motivoStatus}`, {
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

  async encerrar(
    ctx: { tenantId: string },
    invoice: Invoice,
    closing: { codigoMunicipio: string; uf: string; dataEncerramento?: string },
  ): Promise<Invoice> {
    if (invoice.type !== InvoiceType.MDFE) {
      throw new BadRequestException('Encerramento só aplicável a MDF-e');
    }
    if (!invoice.accessKey || !invoice.protocol) {
      throw new BadRequestException('MDF-e sem accessKey/protocolo — não pode ser encerrado');
    }
    const cnpj = invoice.accessKey.substring(6, 20);
    const tpAmb = invoice.environment === 'PRODUCTION' ? '1' : '2';
    const cert = await this.certs.resolveForEmitter(ctx.tenantId, cnpj);
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso: invoice.accessKey, kind: 'MDFE_CLOSE' },
    });

    const eventoXml = buildMdfeEventoEncerramento({
      chaveAcesso: invoice.accessKey,
      cnpj,
      protocolo: invoice.protocol,
      codigoMunicipio: closing.codigoMunicipio,
      uf: closing.uf,
      dataEncerramento: closing.dataEncerramento,
      tpAmb,
    });
    const signed = this.signer.signEvent(eventoXml, decrypted);
    const soapBody = wrapMdfeEvento(signed);
    const endpoints = getMDFeEndpoints(invoice.environment === 'PRODUCTION' ? 'producao' : 'homologacao');
    const soapResponse = await this.soap.send(
      endpoints.recepcaoEvento,
      SOAP_ACTION_MDFE_EVENTO,
      soapBody,
      decrypted,
    );
    const retorno = unwrapMdfeMsg(this.soap.parseEnvelopeBody(soapResponse));
    const resultado = parseMdfeEventoRetorno(retorno, invoice.accessKey);
    if (!resultado.success) {
      throw new SefazError(`Encerramento MDF-e rejeitado: ${resultado.motivoStatus}`, {
        cStat: resultado.codigoStatus,
      });
    }

    const closeKey = `tenants/${ctx.tenantId}/invoices/${invoice.id}/close-event.xml`;
    await this.storage.put(closeKey, Buffer.from(signed, 'utf8'), 'application/xml');
    await this.audit.record('INVOICE_EMIT', {
      tenantId: ctx.tenantId,
      resourceId: invoice.id,
      metadata: { event: 'MDFE_ENCERRAMENTO', protocolo: resultado.protocolo },
    });
    return this.prisma.asPrivileged().invoice.update({
      where: { id: invoice.id },
      data: {
        statusMessage: `${resultado.codigoStatus}: ${resultado.motivoStatus} (encerrado)`,
        metadata: {
          ...(invoice.metadata as Record<string, unknown> | null ?? {}),
          encerradoEm: new Date().toISOString(),
          encerramentoProtocolo: resultado.protocolo,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async consultar(ctx: { tenantId: string }, invoice: Invoice): Promise<SefazResponse> {
    if (!invoice.accessKey) throw new BadRequestException('Invoice sem accessKey');
    const cnpj = invoice.accessKey.substring(6, 20);
    const tpAmb = invoice.environment === 'PRODUCTION' ? '1' : '2';
    const cert = await this.certs.resolveForEmitter(ctx.tenantId, cnpj);
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso: invoice.accessKey, kind: 'MDFE_QUERY' },
    });

    const inner = buildMdfeConsSit(invoice.accessKey, tpAmb);
    const soapBody = wrapMdfeConsulta(inner);
    const endpoints = getMDFeEndpoints(invoice.environment === 'PRODUCTION' ? 'producao' : 'homologacao');
    const soapResponse = await this.soap.send(
      endpoints.consulta,
      SOAP_ACTION_MDFE_CONSULTA,
      soapBody,
      decrypted,
    );
    const retorno = unwrapMdfeMsg(this.soap.parseEnvelopeBody(soapResponse));
    return parseMdfeConsultaRetorno(retorno, invoice.accessKey);
  }
}

function unwrapMdfeMsg(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const inner = obj[key];
    if (
      inner &&
      typeof inner === 'object' &&
      ('cStat' in (inner as object) ||
        'protMDFe' in (inner as object) ||
        'retEventoMDFe' in (inner as object) ||
        'retMDFe' in (inner as object))
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
