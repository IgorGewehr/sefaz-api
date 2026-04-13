// ============================================================
// NfseProviderFactory
//
// Recebe o código IBGE do município e retorna a instância
// do provedor correto (Betha, Nacional, etc).
//
// Singletons: cada provider é instanciado uma vez e reutilizado.
// ============================================================

import type { INfseProvider } from './provider.interface';
import { NacionalProvider } from './nacional.provider';
import { BethaProvider } from './betha.provider';
import { resolveProviderType } from './provider-config';

// Singletons
let nacionalInstance: NacionalProvider | null = null;
let bethaInstance: BethaProvider | null = null;

/**
 * Retorna o provedor de NFS-e correto para o município informado.
 *
 * @param codigoMunicipio — Código IBGE de 7 dígitos (ex: '4207601')
 * @returns Instância do provedor (Betha ou Nacional)
 */
export function getProvider(codigoMunicipio: string): INfseProvider {
  const tipo = resolveProviderType(codigoMunicipio);

  switch (tipo) {
    case 'betha':
      if (!bethaInstance) bethaInstance = new BethaProvider();
      return bethaInstance;

    case 'nacional':
    default:
      if (!nacionalInstance) nacionalInstance = new NacionalProvider();
      return nacionalInstance;
  }
}

/**
 * Retorna o nome do provedor para um município (para logs/debug).
 */
export function getProviderName(codigoMunicipio: string): string {
  return getProvider(codigoMunicipio).nome;
}
