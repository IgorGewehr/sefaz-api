import { Injectable, Logger, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Invoice, InvoiceType } from '@prisma/client';
import { PrismaService } from '@app/database';
import { StorageService } from '@app/storage';
import { generateDanfe } from '@app/fiscal-core';

/**
 * DANFE PDF generator. Reads the authorized `nfeProc` XML from storage and
 * delegates to the migrated PDFKit generator (auto-routes to NF-e A4 layout
 * for modelo 55 or NFC-e 80mm for modelo 65). Caches the result back into
 * storage so the next request streams without re-rendering.
 */
@Injectable()
export class DanfeService {
  private readonly logger = new Logger(DanfeService.name);

  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async render(tenantId: string, invoiceId: string): Promise<Buffer> {
    const invoice = await this.prisma.asPrivileged().invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }
    if (invoice.danfeStoragePath) {
      try {
        return await this.storage.get(invoice.danfeStoragePath);
      } catch (err) {
        this.logger.warn(`DANFE cache miss for ${invoiceId}: ${(err as Error).message} — regenerating`);
      }
    }
    if (invoice.type !== InvoiceType.NFE && invoice.type !== InvoiceType.NFCE) {
      throw new NotImplementedException(`DANFE not applicable to ${invoice.type}`);
    }

    const xml = await this.loadAuthorizedXml(invoice);
    const pdf = await generateDanfe(xml, statusForDanfe(invoice));

    const key = StorageService.keyFor({
      tenantId,
      invoiceId: invoice.id,
      kind: 'danfe',
    });
    await this.storage.put(key, pdf, 'application/pdf');
    await this.prisma.asPrivileged().invoice.update({
      where: { id: invoice.id },
      data: { danfeStoragePath: key },
    });
    return pdf;
  }

  private async loadAuthorizedXml(invoice: Invoice): Promise<string> {
    const path = invoice.xmlStoragePath ?? invoice.signedXmlStoragePath;
    if (!path) {
      throw new NotFoundException(
        `Invoice ${invoice.id} has no XML stored — emit it before rendering DANFE`,
      );
    }
    const buf = await this.storage.get(path);
    return buf.toString('utf8');
  }
}

function statusForDanfe(invoice: Invoice): string | undefined {
  if (invoice.status === 'CANCELLED') return 'cancelled';
  if (invoice.status === 'AUTHORIZED') return undefined; // generator omits watermark
  return invoice.status.toLowerCase();
}
