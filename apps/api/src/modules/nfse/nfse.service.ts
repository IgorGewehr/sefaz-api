import { Injectable, NotImplementedException } from '@nestjs/common';
import { Invoice } from '@prisma/client';

@Injectable()
export class NfseService {
  async emit(_ctx: { tenantId: string }, _payload: Record<string, unknown>): Promise<Invoice> {
    throw new NotImplementedException('NFSe provider routing not yet wired — see Roadmap §Fase 3');
  }

  async cancel(_ctx: { tenantId: string }, _invoice: Invoice, _reason: string): Promise<Invoice> {
    throw new NotImplementedException('NFSe cancellation depends on per-provider impl');
  }
}
