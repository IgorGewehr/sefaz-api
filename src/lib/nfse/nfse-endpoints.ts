// ============================================================
// NFS-e PADRÃO NACIONAL — Endpoints REST do ADN
// API REST JSON com mTLS (não é mais SOAP/ABRASF)
// Referência: https://www.gov.br/nfse/pt-br
// ============================================================

type Ambiente = 'producao' | 'homologacao';

export interface AdnEndpoints {
  /** POST — Enviar DPS (Declaração de Prestação de Serviços) */
  emitir: string;
  /** GET — Consultar NFS-e por chave de acesso */
  consultar: string;
  /** POST — Cancelar NFS-e */
  cancelar: string;
  /** POST — Substituir NFS-e */
  substituir: string;
  /** GET — Consultar DPS pelo id */
  consultarDps: string;
}

const ADN_PRODUCAO: AdnEndpoints = {
  // Emissão/Cancelamento/Substituição → SEFIN Nacional (recepção de DPS)
  emitir: 'https://sefin.nfse.gov.br/SefinNacional/nfse',
  cancelar: 'https://sefin.nfse.gov.br/SefinNacional/nfse/cancelar',
  substituir: 'https://sefin.nfse.gov.br/SefinNacional/nfse/substituir',
  // Consultas → ADN (distribuição)
  consultar: 'https://adn.nfse.gov.br/contribuintes/nfse',
  consultarDps: 'https://adn.nfse.gov.br/contribuintes/dps',
};

const ADN_HOMOLOGACAO: AdnEndpoints = {
  // Emissão/Cancelamento/Substituição → SEFIN Nacional (produção restrita)
  emitir: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse',
  cancelar: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/cancelar',
  substituir: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/substituir',
  // Consultas → ADN (produção restrita)
  consultar: 'https://adn.producaorestrita.nfse.gov.br/contribuintes/nfse',
  consultarDps: 'https://adn.producaorestrita.nfse.gov.br/contribuintes/dps',
};

export function getAdnEndpoints(ambiente: Ambiente): AdnEndpoints {
  return ambiente === 'producao' ? ADN_PRODUCAO : ADN_HOMOLOGACAO;
}
