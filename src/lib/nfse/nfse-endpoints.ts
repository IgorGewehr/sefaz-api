// ============================================================
// NFS-e PADRÃO NACIONAL — Endpoints REST da SEFIN Nacional
// API REST JSON com mTLS (não é mais SOAP/ABRASF)
// Referência: https://www.gov.br/nfse/pt-br (Swagger contribuintes ISSQN)
//
// Contrato SefinNacional (evidência: swagger contribuintesissqn +
// implementação de referência pedrocasado/nfse-php):
//   POST {base}/nfse                      body { dpsXmlGZipB64 }
//   GET  {base}/nfse/{chaveAcesso}        → { nfseXmlGZipB64, ... }
//   GET  {base}/dps/{idDps}               → chave de acesso da NFS-e do DPS
//   POST {base}/nfse/{chave}/eventos      body { pedidoRegistroEventoXmlGZipB64 }
// ============================================================

type Ambiente = 'producao' | 'homologacao';

export interface AdnEndpoints {
  /** POST — Enviar DPS (Declaração de Prestação de Serviços) */
  emitir: string;
  /** GET — Consultar NFS-e por chave de acesso: `${consultar}/{chave50}` */
  consultar: string;
  /**
   * POST — Registrar evento (cancelamento e101101 etc.):
   * `${eventos}/{chave50}/eventos`
   */
  eventos: string;
  /**
   * @deprecated Cancelamento no Padrão Nacional é via evento e101101 em
   * `${eventos}/{chave}/eventos` — mantido por compat (aponta pra mesma base).
   */
  cancelar: string;
  /** POST — Substituir NFS-e */
  substituir: string;
  /** GET — Consultar DPS pelo Id (45 chars "DPS"+42 díg): `${consultarDps}/{idDps}` */
  consultarDps: string;
}

const SEFIN_PROD = 'https://sefin.nfse.gov.br/SefinNacional';
const SEFIN_HOMOLOG = 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional';

const ADN_PRODUCAO: AdnEndpoints = {
  emitir: `${SEFIN_PROD}/nfse`,
  consultar: `${SEFIN_PROD}/nfse`,
  eventos: `${SEFIN_PROD}/nfse`,
  cancelar: `${SEFIN_PROD}/nfse`,
  substituir: `${SEFIN_PROD}/nfse/substituir`,
  consultarDps: `${SEFIN_PROD}/dps`,
};

const ADN_HOMOLOGACAO: AdnEndpoints = {
  emitir: `${SEFIN_HOMOLOG}/nfse`,
  consultar: `${SEFIN_HOMOLOG}/nfse`,
  eventos: `${SEFIN_HOMOLOG}/nfse`,
  cancelar: `${SEFIN_HOMOLOG}/nfse`,
  substituir: `${SEFIN_HOMOLOG}/nfse/substituir`,
  consultarDps: `${SEFIN_HOMOLOG}/dps`,
};

export function getAdnEndpoints(ambiente: Ambiente): AdnEndpoints {
  return ambiente === 'producao' ? ADN_PRODUCAO : ADN_HOMOLOGACAO;
}
