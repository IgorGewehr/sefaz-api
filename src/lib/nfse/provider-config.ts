// ============================================================
// NFS-e Provider Config — Mapeamento Município → Provedor
//
// Para adicionar uma nova cidade Betha, basta incluir o código
// IBGE no array BETHA_MUNICIPIOS. Nenhum código novo necessário.
// ============================================================

export type NfseProviderType = 'betha' | 'nacional';

/**
 * Municípios que usam Betha Sistemas.
 * Lista mantida manualmente — adicione o código IBGE de 7 dígitos.
 *
 * Fontes:
 * - https://nota-eletronica.betha.cloud
 * - Contratos municipais com a Betha
 */
const BETHA_MUNICIPIOS: ReadonlySet<string> = new Set([
  // Santa Catarina
  '4213104', // São José
  '4205407', // Florianópolis
  '4209102', // Joinville
  '4204202', // Criciúma
  '4202404', // Blumenau
  '4204608', // Chapecó
  '4208203', // Itajaí
  '4211306', // Palhoça
  '4201307', // Balneário Camboriú
  '4209003', // Jaraguá do Sul
  '4205902', // Gaspar
  '4200804', // Araranguá
  '4207601', // Ipira
  '4201901', // Biguaçu
  '4202909', // Brusque
  '4203006', // Caçador
  '4204103', // Concórdia
  '4207502', // Indaial
  '4210100', // Lages
  '4211900', // Penha
  '4214805', // Timbó
  '4215802', // Videira
  '4216602', // Xanxerê

  // Rio Grande do Sul (exemplos)
  '4303004', // Canoas
  '4307708', // Erechim
]);

/**
 * Resolve o tipo de provedor para um código de município.
 * Se o município estiver na lista Betha, retorna 'betha'.
 * Caso contrário, retorna 'nacional' (ADN — padrão federal).
 */
export function resolveProviderType(codigoMunicipio: string): NfseProviderType {
  const codigo = codigoMunicipio.replace(/\D/g, '').slice(0, 7);
  return BETHA_MUNICIPIOS.has(codigo) ? 'betha' : 'nacional';
}

/**
 * Retorna a lista de municípios Betha (para debug/admin).
 */
export function getBethaMunicipios(): string[] {
  return Array.from(BETHA_MUNICIPIOS);
}
