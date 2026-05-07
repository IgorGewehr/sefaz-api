import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invoice, InvoiceStatus, InvoiceType, Environment } from '@prisma/client';
import { PrismaService } from '@app/database';
import { StorageService } from '@app/storage';
import { XmlSignerService } from '@app/sefaz';
import {
  buildNFCeXml,
  gerarCodigoNumerico,
  montarChaveAcesso,
  UF_CODES,
  type NFCeRequest,
  type RespTec,
} from '@app/fiscal-core';
import { CertificateService } from '../certificate/certificate.service';
import { AuditService } from '../audit/audit.service';

interface EmitContext {
  tenantId: string;
  idempotencyKey?: string;
}

@Injectable()
export class NfceService {
  private readonly logger = new Logger(NfceService.name);
  private readonly respTec: RespTec;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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
    const request = payload as unknown as NFCeRequest;
    const ufEmitente = request.ufEmitente.toUpperCase();
    const cUF = UF_CODES[ufEmitente];
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
      modelo: '65',
      serie: request.serie ?? '1',
      numero: request.numero,
      tipoEmissao: '1',
      codigoNumerico: cNF,
      uf: ufEmitente,
    });

    const xml = buildNFCeXml(request, chaveAcesso, request.numero, tpAmb, this.respTec);
    const decrypted = await this.certs.decrypt(ctx.tenantId, cert.id, {
      metadata: { chaveAcesso, kind: 'NFCE_EMIT' },
    });
    const signed = this.signer.signEnvelope(xml, decrypted, 'infNFe');

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
        issuer: request.emitente as never,
        recipient: (request.consumidor ?? {}) as never,
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
    this.logger.debug(`NFCe ${chaveAcesso} signed and stored at ${xmlKey}`);

    await this.audit.record('INVOICE_EMIT', {
      tenantId: ctx.tenantId,
      resourceId: invoice.id,
      metadata: { type: InvoiceType.NFCE, accessKey: chaveAcesso },
    });

    return this.prisma.asPrivileged().invoice.update({
      where: { id: invoice.id },
      data: { signedXmlStoragePath: xmlKey, status: InvoiceStatus.PENDING },
    });
  }

  async cancel(_ctx: { tenantId: string }, _invoice: Invoice, _reason: string): Promise<Invoice> {
    throw new NotImplementedException('NFCe cancellation not yet implemented');
  }
}
