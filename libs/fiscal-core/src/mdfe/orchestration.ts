// =====================================================================
// MDF-e SOAP orchestration helpers. Migrated from legacy/services/mdfe.
// Pure: no I/O, no DI. Consumed by apps/api/src/modules/mdfe.
// =====================================================================

import type { SefazResponse } from '../types';

export const MDFE_NS = 'http://www.portalfiscal.inf.br/mdfe';
export const MDFE_RECEPCAO_NS = 'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoSinc';
export const MDFE_CONSULTA_NS = 'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeConsulta';
export const MDFE_STATUS_NS = 'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeStatusServico';
export const MDFE_EVENTO_NS = 'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoEvento';

export const SOAP_ACTION_MDFE_RECEPCAO = `${MDFE_RECEPCAO_NS}/mdfeRecepcaoSinc`;
export const SOAP_ACTION_MDFE_CONSULTA = `${MDFE_CONSULTA_NS}/mdfeConsultaMDFe`;
export const SOAP_ACTION_MDFE_STATUS = `${MDFE_STATUS_NS}/mdfeStatusServico`;
export const SOAP_ACTION_MDFE_EVENTO = `${MDFE_EVENTO_NS}/mdfeRecepcaoEvento`;

// --- SOAP body wrappers ---

export function wrapMdfeRecepcaoSinc(signedXml: string): string {
  return (
    `<mdfeRecepcaoSinc xmlns="${MDFE_RECEPCAO_NS}">` +
    `<mdfeDadosMsg>${signedXml}</mdfeDadosMsg>` +
    `</mdfeRecepcaoSinc>`
  );
}

export function wrapMdfeConsulta(consultaXml: string): string {
  return (
    `<mdfeConsultaMDFe xmlns="${MDFE_CONSULTA_NS}">` +
    `<mdfeDadosMsg>${consultaXml}</mdfeDadosMsg>` +
    `</mdfeConsultaMDFe>`
  );
}

export function wrapMdfeStatus(statusXml: string): string {
  return (
    `<mdfeStatusServico xmlns="${MDFE_STATUS_NS}">` +
    `<mdfeDadosMsg>${statusXml}</mdfeDadosMsg>` +
    `</mdfeStatusServico>`
  );
}

export function wrapMdfeEvento(signedEventXml: string): string {
  return (
    `<mdfeRecepcaoEvento xmlns="${MDFE_EVENTO_NS}">` +
    `<mdfeDadosMsg>${signedEventXml}</mdfeDadosMsg>` +
    `</mdfeRecepcaoEvento>`
  );
}

// --- Inner XMLs (consSit / consStatServ) ---

export function buildMdfeConsSit(chaveAcesso: string, tpAmb: '1' | '2'): string {
  return (
    `<consSitMDFe xmlns="${MDFE_NS}" versao="3.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<xServ>CONSULTAR</xServ>` +
    `<chMDFe>${chaveAcesso}</chMDFe>` +
    `</consSitMDFe>`
  );
}

export function buildMdfeConsStatServ(tpAmb: '1' | '2'): string {
  return (
    `<consStatServMDFe xmlns="${MDFE_NS}" versao="3.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<xServ>STATUS</xServ>` +
    `</consStatServMDFe>`
  );
}

// --- Response parsers ---

interface RetMdfe {
  cStat?: string;
  xMotivo?: string;
  protMDFe?: { infProt?: { nProt?: string; dhRecbto?: string } };
  infProt?: { nProt?: string; dhRecbto?: string };
}

export function parseMdfeRetorno(retorno: unknown, chaveAcesso: string): SefazResponse {
  const root = retorno as Record<string, unknown>;
  const ret = (root?.['retMDFe'] ?? root) as RetMdfe;
  const cStat = String(ret?.cStat ?? '0');
  const xMotivo = String(ret?.xMotivo ?? 'Resposta não reconhecida');
  const nProt = ret?.protMDFe?.infProt?.nProt ?? ret?.infProt?.nProt;
  const dhRecbto = ret?.protMDFe?.infProt?.dhRecbto ?? ret?.infProt?.dhRecbto;

  if (cStat === '100') {
    return {
      success: true,
      status: 'autorizado',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: nProt ? String(nProt) : undefined,
      dataRecebimento: dhRecbto ? String(dhRecbto) : undefined,
    };
  }
  if (['103', '104', '105'].includes(cStat)) {
    return { success: false, status: 'processando', codigoStatus: cStat, motivoStatus: xMotivo, chaveAcesso };
  }
  if (cStat.startsWith('3')) {
    return {
      success: false,
      status: 'denegado',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: nProt ? String(nProt) : undefined,
    };
  }
  return {
    success: false,
    status: 'rejeitado',
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: xMotivo ? [xMotivo] : undefined,
  };
}

export function parseMdfeConsultaRetorno(retorno: unknown, chaveAcesso: string): SefazResponse {
  const root = retorno as Record<string, unknown>;
  const ret = (root?.['retConsSitMDFe'] ?? root) as RetMdfe;
  const cStat = String(ret?.cStat ?? '0');
  const xMotivo = String(ret?.xMotivo ?? 'Resposta não reconhecida');
  const nProt = ret?.protMDFe?.infProt?.nProt ?? ret?.infProt?.nProt;
  const dhRecbto = ret?.protMDFe?.infProt?.dhRecbto ?? ret?.infProt?.dhRecbto;

  if (cStat === '100') {
    return {
      success: true,
      status: 'autorizado',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: nProt ? String(nProt) : undefined,
      dataRecebimento: dhRecbto ? String(dhRecbto) : undefined,
    };
  }
  if (cStat === '101') {
    return {
      success: true,
      status: 'cancelado',
      codigoStatus: cStat,
      motivoStatus: 'MDF-e cancelado',
      chaveAcesso,
      protocolo: nProt ? String(nProt) : undefined,
    };
  }
  return {
    success: false,
    status: 'rejeitado',
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: xMotivo ? [xMotivo] : undefined,
  };
}

interface RetEventoMdfe {
  retEventoMDFe?: { infEvento?: InfEvento } | InfEvento;
  infEvento?: InfEvento;
  cStat?: string;
  xMotivo?: string;
  nProt?: string;
  dhRegEvento?: string;
}

interface InfEvento {
  cStat?: string;
  xMotivo?: string;
  nProt?: string;
  dhRegEvento?: string;
}

export function parseMdfeEventoRetorno(
  retorno: unknown,
  chaveAcesso: string,
): SefazResponse {
  const root = retorno as RetEventoMdfe;
  const ret = (root?.retEventoMDFe ?? root) as RetEventoMdfe & InfEvento;
  const infEvento = ((ret as { infEvento?: InfEvento })?.infEvento ?? ret) as InfEvento;

  const cStat = String(infEvento?.cStat ?? '0');
  const xMotivo = String(infEvento?.xMotivo ?? 'Resposta não reconhecida');
  const nProt = infEvento?.nProt;
  const dhRegEvento = infEvento?.dhRegEvento;

  if (cStat === '135' || cStat === '136') {
    return {
      success: true,
      status: 'autorizado',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: nProt ? String(nProt) : undefined,
      dataRecebimento: dhRegEvento ? String(dhRegEvento) : undefined,
    };
  }
  return {
    success: false,
    status: 'rejeitado',
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: xMotivo ? [xMotivo] : undefined,
  };
}

export function parseMdfeStatusRetorno(retorno: unknown): SefazResponse {
  const root = retorno as Record<string, unknown>;
  const ret = (root?.['retConsStatServMDFe'] ?? root) as RetMdfe;
  const cStat = String(ret?.cStat ?? '0');
  const xMotivo = String(ret?.xMotivo ?? 'Resposta não reconhecida');
  return {
    success: cStat === '107',
    status: cStat === '107' ? 'autorizado' : 'erro',
    codigoStatus: cStat,
    motivoStatus: xMotivo,
  };
}
