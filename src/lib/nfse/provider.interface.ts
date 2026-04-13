// ============================================================
// INfseProvider - Interface para provedores de NFS-e
//
// Cada município pode usar um provedor diferente (Betha, Nacional, etc).
// A factory seleciona o provedor correto com base no código IBGE.
// ============================================================

import type {
  NfseEmitirRequest,
  NfseCancelarRequest,
  NfseConsultarNfseRequest,
  NfseResponse,
} from '../../types/nfse';

export interface INfseProvider {
  readonly nome: string;

  emitir(request: NfseEmitirRequest): Promise<NfseResponse>;
  cancelar(request: NfseCancelarRequest): Promise<NfseResponse>;
  consultar(request: NfseConsultarNfseRequest): Promise<NfseResponse>;
}
