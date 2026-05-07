import { Injectable, NotImplementedException } from '@nestjs/common';
import type { NfseProvider } from './provider.interface';

/**
 * Resolves the NFSe provider for a given IBGE city code. The full mapping
 * lives in legacy/lib/nfse/provider-config.ts and gets ported as we onboard
 * new cities. Today every lookup throws — keep it explicit so callers see
 * the gap instead of silently routing to a wrong provider.
 */
@Injectable()
export class NfseProviderFactory {
  forCity(_codigoIbge: string): NfseProvider {
    throw new NotImplementedException(
      'NFSe provider routing is scaffolded — port Betha / Nacional / São Paulo before enabling.',
    );
  }
}
