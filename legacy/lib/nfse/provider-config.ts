// ============================================================
// NFS-e Provider Config — Mapeamento Município → Provedor
//
// Para adicionar uma nova cidade Betha, basta incluir o código
// IBGE no array BETHA_MUNICIPIOS. Nenhum código novo necessário.
// ============================================================

export type NfseProviderType = 'betha' | 'betha-legacy' | 'saopaulo' | 'nacional';

/**
 * Municípios que usam Betha Cloud DPS (Padrão Nacional / formato DPS).
 * Lista mantida manualmente — adicione o código IBGE de 7 dígitos.
 */
const BETHA_MUNICIPIOS: ReadonlySet<string> = new Set([
  // Santa Catarina
  '4216402', // São José
  '4205407', // Florianópolis
  '4209102', // Joinville
  '4204608', // Criciúma
  '4202404', // Blumenau
  '4204202', // Chapecó
  '4208203', // Itajaí
  '4211900', // Palhoça
  '4202008', // Balneário Camboriú
  '4208906', // Jaraguá do Sul
  '4205902', // Gaspar
  '4201406', // Araranguá
  '4202305', // Biguaçu
  '4202909', // Brusque
  '4203006', // Caçador
  '4204301', // Concórdia
  '4207502', // Indaial
  '4209300', // Lages
  '4212502', // Penha
  '4216907', // Timbó
  '4217002', // Videira
  '4217703', // Xanxerê
  '4207601', // Ipira

  // Rio Grande do Sul
  '4304606', // Canoas
  '4307005', // Erechim
]);

/**
 * Municípios que usam Nota Fiscal Paulistana (sistema próprio da Prefeitura de SP).
 * Endpoint: https://nfews.prefeitura.sp.gov.br/lotenfe.asmx
 */
const SP_MUNICIPIOS: ReadonlySet<string> = new Set([
  '3550308', // São Paulo/SP
]);

/**
 * Municípios que usam Betha Legacy (ABRASF 2.02 / RPS).
 * Portal: e-gov.betha.com.br — endpoint: /e-nota-contribuinte-ws/nfseWS
 */
const BETHA_LEGACY_MUNICIPIOS: ReadonlySet<string> = new Set([
  // Nenhum município confirmado no Legacy até o momento.
  // Adicione aqui se algum município ainda usar e-gov.betha.com.br (portal antigo).
]);

/**
 * Resolve o tipo de provedor para um código de município.
 */
export function resolveProviderType(codigoMunicipio: string): NfseProviderType {
  const codigo = codigoMunicipio.replace(/\D/g, '').slice(0, 7);
  if (SP_MUNICIPIOS.has(codigo)) return 'saopaulo';
  if (BETHA_LEGACY_MUNICIPIOS.has(codigo)) return 'betha-legacy';
  if (BETHA_MUNICIPIOS.has(codigo)) return 'betha';
  return 'nacional';
}

/**
 * Retorna a lista de municípios Betha (para debug/admin).
 */
export function getBethaMunicipios(): string[] {
  return Array.from(BETHA_MUNICIPIOS);
}
