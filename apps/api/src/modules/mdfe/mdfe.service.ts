import { Injectable, NotImplementedException } from '@nestjs/common';
import { Invoice } from '@prisma/client';

@Injectable()
export class MdfeService {
  async emit(_ctx: { tenantId: string }, _payload: Record<string, unknown>): Promise<Invoice> {
    throw new NotImplementedException(
      'MDFe orchestration is scaffolded — port MDFeRecepcaoSinc + encerramento next.',
    );
  }

  async cancel(_ctx: { tenantId: string }, _invoice: Invoice, _reason: string): Promise<Invoice> {
    throw new NotImplementedException('MDFe cancellation not yet implemented');
  }
}
