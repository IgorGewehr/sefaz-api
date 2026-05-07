import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice, InvoiceStatus, InvoiceType, Environment } from '@prisma/client';
import { PrismaService } from '@app/database';
import { StorageService } from '@app/storage';
import { SoapClientService, XmlSignerService, getNFeEndpoints } from '@app/sefaz';
import {
  buildNFeXml,
  gerarCodigoNumerico,
  montarChaveAcesso,
  UF_CODES,
  type NFeRequest,
  type RespTec,
} from '@app/fiscal-core';
import { CertificateService } from '../certificate/certificate.service';
import { AuditService } from '../audit/audit.service';

interface EmitContext {
  tenantId: string;
  idempotencyKey?: string;
}

/**
 * NFe orchestration. End-to-end flow on the happy path:
 *   1. Decrypt the tenant cert (envelope encryption + KMS).
 *   2. Build XML, sign with SHA-1 (SVRS rejects SHA-256 — code 225).
 *   3. POST to NFeAutorizacao4 (SOAP 1.2, mTLS, keep-alive).
 *   4. Persist Invoice + signed XML in storage.
 *   5. Audit + emit `invoice.authorized` webhook.
 *
 * The async polling / cancel / CC-e / inutilization paths are scaffolded but
 * delegated to the SEFAZ orchestration module that lives in `legacy/services/`
 * and is being ported lib-by-lib. Until the porting completes we persist as
 * PENDING and let the worker reconcile.
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
    const ufEmitente = request.ufEmitente?.toUpperCase();
    const cUF = ufEmitente ? UF_CODES[ufEmitente] : undefined;
    if (!cUF) throw new Error(`UF inválida: ${request.ufEmitente}`);

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
    const signed = this.signer.signEnvelope(xml, decrypted, 'infNFe');

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
        issuer: request.emitente as never,
        recipient: request.destinatario as never,
        items: request.itens as never,
        totals: {} as never,
        payment: request.pagamento as never,
        idempotencyKey: ctx.idempotencyKey,
      },
    });

    const xmlKey = StorageService.keyFor({
      tenantId: ctx.tenantId,
      invoiceId: invoice.id,
      kind: 'signed-xml',
    });
    await this.storage.put(xmlKey, Buffer.from(signed, 'utf8'), 'application/xml');

    // TODO: dispatch to SEFAZ NFeAutorizacao4 + poll retAutorizacao + parse
    //       protocol, then update status to AUTHORIZED. Endpoint resolution
    //       already wired below for when the orchestration is finished.
    const endpoints = getNFeEndpoints(ufEmitente, ambiente === 'PRODUCTION' ? 'producao' : 'homologacao');
    this.logger.debug(`Endpoints resolved for ${ufEmitente}/${ambiente}: ${endpoints.autorizacao}`);

    await this.audit.record('INVOICE_EMIT', {
      tenantId: ctx.tenantId,
      resourceId: invoice.id,
      metadata: { type: InvoiceType.NFE, accessKey: chaveAcesso },
    });

    return this.prisma.asPrivileged().invoice.update({
      where: { id: invoice.id },
      data: { signedXmlStoragePath: xmlKey, status: InvoiceStatus.PENDING },
    });
  }

  async cancel(_ctx: { tenantId: string }, _invoice: Invoice, _reason: string): Promise<Invoice> {
    throw new NotImplementedException(
      'NFe cancellation orchestration not yet ported from legacy. Tracking in roadmap §Fase 2.',
    );
  }
}
