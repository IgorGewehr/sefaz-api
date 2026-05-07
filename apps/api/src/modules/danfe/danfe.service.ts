import { Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { InvoiceType } from '@prisma/client';
import { PrismaService } from '@app/database';
import { StorageService } from '@app/storage';

/**
 * DANFE PDF generator. The legacy implementation lives in
 * `gestao-raiz/lib/danfe-generator.ts` (PDFKit, A4 + 80mm) and gets ported
 * once the InvoiceModule is fully producing authorized XMLs. Until then this
 * returns the stored PDF when one exists or 501 otherwise.
 */
@Injectable()
export class DanfeService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async render(tenantId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.prisma.asPrivileged().invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }
    if (invoice.danfeStoragePath) {
      return this.storage.get(invoice.danfeStoragePath);
    }
    if (invoice.type !== InvoiceType.NFE && invoice.type !== InvoiceType.NFCE) {
      throw new NotImplementedException(`DANFE not applicable to ${invoice.type}`);
    }
    throw new NotImplementedException(
      'DANFE PDF generation not yet ported from gestao-raiz — see Roadmap §Fase 2.',
    );
  }
}
