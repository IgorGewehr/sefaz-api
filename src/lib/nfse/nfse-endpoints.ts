// ============================================================
// NFS-e PADRÃO NACIONAL - Endpoints ADN (Ambiente de Dados Nacional)
// Referência: https://www.gov.br/nfse
// ============================================================

type Ambiente = 'producao' | 'homologacao';

export interface NfseWebServices {
  /** Recepção de lote de RPS (envio) */
  recepcionarLoteRps: string;
  /** Consultar situação do lote */
  consultarSituacaoLoteRps: string;
  /** Consultar lote de RPS */
  consultarLoteRps: string;
  /** Consultar NFS-e por RPS */
  consultarNfsePorRps: string;
  /** Consultar NFS-e (por faixa ou serviços prestados) */
  consultarNfse: string;
  /** Cancelar NFS-e */
  cancelarNfse: string;
}

// ============================================================
// ADN - Ambiente de Dados Nacional (Padrão Nacional)
// Endpoint federal único — não depende de prefeitura
// ============================================================

const ADN_PRODUCAO: NfseWebServices = {
  recepcionarLoteRps: 'https://sefin.nfse.gov.br/sefinnacional/services/producao/nfse',
  consultarSituacaoLoteRps: 'https://sefin.nfse.gov.br/sefinnacional/services/producao/nfse',
  consultarLoteRps: 'https://sefin.nfse.gov.br/sefinnacional/services/producao/nfse',
  consultarNfsePorRps: 'https://sefin.nfse.gov.br/sefinnacional/services/producao/nfse',
  consultarNfse: 'https://sefin.nfse.gov.br/sefinnacional/services/producao/nfse',
  cancelarNfse: 'https://sefin.nfse.gov.br/sefinnacional/services/producao/nfse',
};

const ADN_HOMOLOGACAO: NfseWebServices = {
  recepcionarLoteRps: 'https://sefin.nfse.gov.br/sefinnacional/services/homologacao/nfse',
  consultarSituacaoLoteRps: 'https://sefin.nfse.gov.br/sefinnacional/services/homologacao/nfse',
  consultarLoteRps: 'https://sefin.nfse.gov.br/sefinnacional/services/homologacao/nfse',
  consultarNfsePorRps: 'https://sefin.nfse.gov.br/sefinnacional/services/homologacao/nfse',
  consultarNfse: 'https://sefin.nfse.gov.br/sefinnacional/services/homologacao/nfse',
  cancelarNfse: 'https://sefin.nfse.gov.br/sefinnacional/services/homologacao/nfse',
};

// ============================================================
// SOAP Actions - NFS-e Padrão Nacional
// ============================================================

export const NFSE_SOAP_ACTIONS = {
  recepcionarLoteRps: 'http://www.abrasf.org.br/nfse.xsd/RecepcionarLoteRps',
  consultarSituacaoLoteRps: 'http://www.abrasf.org.br/nfse.xsd/ConsultarSituacaoLoteRps',
  consultarLoteRps: 'http://www.abrasf.org.br/nfse.xsd/ConsultarLoteRps',
  consultarNfsePorRps: 'http://www.abrasf.org.br/nfse.xsd/ConsultarNfsePorRps',
  consultarNfse: 'http://www.abrasf.org.br/nfse.xsd/ConsultarNfseServicoPrestado',
  cancelarNfse: 'http://www.abrasf.org.br/nfse.xsd/CancelarNfse',
} as const;

// ============================================================
// Função pública
// ============================================================

export function getNfseEndpoints(ambiente: Ambiente): NfseWebServices {
  return ambiente === 'producao' ? ADN_PRODUCAO : ADN_HOMOLOGACAO;
}
