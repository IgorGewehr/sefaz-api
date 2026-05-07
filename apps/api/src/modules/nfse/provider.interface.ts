import type { Invoice } from '@prisma/client';

export interface NfseEmitInput {
  tenantId: string;
  certificateId: string;
  payload: Record<string, unknown>;
}

export interface NfseEmitOutput {
  invoice: Invoice;
}

/**
 * NFSe provider abstraction. Each city/provider implements this. The legacy
 * implementations live in `legacy/lib/nfse/` (Betha, Nacional, São Paulo) —
 * port one at a time as new tenants need them.
 */
export interface NfseProvider {
  readonly name: string;
  emit(input: NfseEmitInput): Promise<NfseEmitOutput>;
  cancel(invoiceId: string, reason: string): Promise<NfseEmitOutput>;
}
