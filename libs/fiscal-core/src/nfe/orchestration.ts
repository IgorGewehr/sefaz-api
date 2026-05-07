// =====================================================================
// Pure helpers for the NFe/NFCe SEFAZ orchestration. Migrated from
// legacy/services/nfe.service.ts but stripped of side effects: every
// function here is deterministic in its inputs.
// =====================================================================

import type { NFeRequest, NFCeRequest, SefazResponse } from '../types';
import { escapeXml } from '../util/cnpj';
import { formatarDataSefaz } from '../util/datetime';

export const SEFAZ_NS = 'http://www.portalfiscal.inf.br/nfe';
export const AUTORIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4';
export const RET_AUTORIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4';
export const CONSULTA_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4';
export const STATUS_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4';
export const RECEPCAO_EVENTO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
export const INUTILIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4';

export const SOAP_ACTION_AUTORIZACAO = `${AUTORIZACAO_NS}/nfeAutorizacaoLote`;
export const SOAP_ACTION_RET_AUTORIZACAO = `${RET_AUTORIZACAO_NS}/nfeRetAutorizacaoLote`;
export const SOAP_ACTION_CONSULTA = `${CONSULTA_NS}/nfeConsultaNF`;
export const SOAP_ACTION_STATUS = `${STATUS_NS}/nfeStatusServicoNF`;
export const SOAP_ACTION_EVENTO = `${RECEPCAO_EVENTO_NS}/nfeRecepcaoEvento`;
export const SOAP_ACTION_INUTILIZACAO = `${INUTILIZACAO_NS}/nfeInutilizacaoNF`;

// --- Status translation ---

export function interpretarStatus(cStat: string): SefazResponse['status'] {
  const code = parseInt(cStat, 10);
  if (code === 100 || code === 150) return 'autorizado';
  if (code === 105 || code === 103) return 'processando';
  if (code === 110 || code === 301 || code === 302 || code === 303) return 'denegado';
  if (code === 135 || code === 136) return 'autorizado';
  if (code === 101) return 'autorizado';
  if (code === 102) return 'autorizado';
  if (code === 107) return 'autorizado';
  if (code >= 200) return 'rejeitado';
  return 'erro';
}

// --- retEnviNFe / retConsReciNFe parsing ---

export function parseRetAutorizacao(retorno: unknown): SefazResponse {
  const root = retorno as Record<string, unknown>;
  const ret = (root['retEnviNFe'] ?? root['retConsReciNFe'] ?? root) as Record<string, unknown>;

  const cStat = String(ret['cStat'] ?? '');
  const xMotivo = String(ret['xMotivo'] ?? '');

  if (cStat === '104' || ret['protNFe']) {
    const protNFe = ret['protNFe'] as Record<string, unknown> | undefined;
    if (protNFe) {
      const infProt = (protNFe['infProt'] ?? protNFe) as Record<string, unknown>;
      const protStat = String(infProt['cStat'] ?? '');
      return {
        success: protStat === '100' || protStat === '150',
        status: interpretarStatus(protStat),
        codigoStatus: protStat,
        motivoStatus: String(infProt['xMotivo'] ?? ''),
        chaveAcesso: String(infProt['chNFe'] ?? ''),
        protocolo: String(infProt['nProt'] ?? ''),
        dataRecebimento: String(infProt['dhRecbto'] ?? ''),
      };
    }
  }

  if (cStat === '100' || cStat === '150') {
    const protNFe = ret['protNFe'] as Record<string, unknown> | undefined;
    if (protNFe) {
      const infProt = (protNFe['infProt'] ?? protNFe) as Record<string, unknown>;
      return {
        success: true,
        status: 'autorizado',
        codigoStatus: String(infProt['cStat'] ?? cStat),
        motivoStatus: String(infProt['xMotivo'] ?? xMotivo),
        chaveAcesso: String(infProt['chNFe'] ?? ''),
        protocolo: String(infProt['nProt'] ?? ''),
        dataRecebimento: String(infProt['dhRecbto'] ?? ''),
      };
    }
  }

  if (cStat === '103' || cStat === '105') {
    const infRec = ret['infRec'] as Record<string, unknown> | undefined;
    return {
      success: false,
      status: 'processando',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      nRec: String(infRec?.['nRec'] ?? ''),
    };
  }

  if (ret['infRec']) {
    const infRec = ret['infRec'] as Record<string, unknown>;
    return {
      success: false,
      status: 'processando',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      nRec: String(infRec['nRec'] ?? ''),
    };
  }

  return {
    success: false,
    status: interpretarStatus(cStat),
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    erros: xMotivo ? [xMotivo] : undefined,
  };
}

export function parseRetEvento(retorno: unknown, chaveAcesso: string): SefazResponse {
  const root = retorno as Record<string, unknown>;
  const ret = (root['retEnvEvento'] ?? root) as Record<string, unknown>;
  const cStatLote = String(ret['cStat'] ?? '');
  const retEvento = ret['retEvento'] as Record<string, unknown> | undefined;

  if (retEvento) {
    const infEvento = (retEvento['infEvento'] ?? retEvento) as Record<string, unknown>;
    const cStat = String(infEvento['cStat'] ?? cStatLote);
    return {
      success: cStat === '135' || cStat === '136' || cStat === '101',
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: String(infEvento['xMotivo'] ?? ''),
      chaveAcesso,
      protocolo: String(infEvento['nProt'] ?? ''),
      dataRecebimento: String(infEvento['dhRegEvento'] ?? ''),
    };
  }

  const xMotivo = String(ret['xMotivo'] ?? '');
  return {
    success: false,
    status: interpretarStatus(cStatLote),
    codigoStatus: cStatLote,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: xMotivo ? [xMotivo] : undefined,
  };
}

// --- Envelope builders ---

export function wrapEnviNFe(signedXml: string, loteId: string, indSinc: '0' | '1'): string {
  const nfeMatch = signedXml.match(/<NFe\s[^]*<\/NFe>/);
  if (!nfeMatch) throw new Error('Não foi possível extrair o elemento NFe do XML assinado');
  return (
    `<nfeDadosMsg xmlns="${AUTORIZACAO_NS}">` +
    `<enviNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
    `<idLote>${loteId}</idLote>` +
    `<indSinc>${indSinc}</indSinc>` +
    nfeMatch[0] +
    `</enviNFe>` +
    `</nfeDadosMsg>`
  );
}

export function wrapConsReciNFe(nRec: string, tpAmb: '1' | '2'): string {
  return (
    `<nfeDadosMsg xmlns="${RET_AUTORIZACAO_NS}">` +
    `<consReciNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<nRec>${nRec}</nRec>` +
    `</consReciNFe>` +
    `</nfeDadosMsg>`
  );
}

export function wrapEventoSoap(signedEventXml: string): string {
  return `<nfeDadosMsg xmlns="${RECEPCAO_EVENTO_NS}">${signedEventXml}</nfeDadosMsg>`;
}

export function wrapInutilizacaoSoap(signedInutXml: string): string {
  return `<nfeDadosMsg xmlns="${INUTILIZACAO_NS}">${signedInutXml}</nfeDadosMsg>`;
}

export function buildNfeProcEnvelope(
  signedXml: string,
  resultado: SefazResponse,
  tpAmb: '1' | '2',
): string {
  return (
    `<nfeProc versao="4.00" xmlns="${SEFAZ_NS}">` +
    signedXml +
    `<protNFe versao="4.00">` +
    `<infProt>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<verAplic>SefazAPI-2.0</verAplic>` +
    `<chNFe>${resultado.chaveAcesso ?? ''}</chNFe>` +
    `<dhRecbto>${resultado.dataRecebimento ?? ''}</dhRecbto>` +
    `<nProt>${resultado.protocolo ?? ''}</nProt>` +
    `<cStat>${resultado.codigoStatus}</cStat>` +
    `<xMotivo>${escapeXml(resultado.motivoStatus)}</xMotivo>` +
    `</infProt>` +
    `</protNFe>` +
    `</nfeProc>`
  );
}

// --- Event XML builders (cancelamento, CC-e, inutilização) ---

export interface EventoCancelamentoInput {
  chaveAcesso: string;
  protocolo: string;
  justificativa: string;
  ufEmitente: string;
  tpAmb: '1' | '2';
  loteId: string;
}

export function buildEventoCancelamentoXml(input: EventoCancelamentoInput): string {
  const { chaveAcesso, protocolo, justificativa, ufEmitente, tpAmb, loteId } = input;
  const cUF = chaveAcesso.substring(0, 2);
  const cnpj = chaveAcesso.substring(6, 20);
  const tpEvento = '110111';
  const nSeqEvento = '1';
  const idEvento = `ID${tpEvento}${chaveAcesso}${nSeqEvento.padStart(2, '0')}`;
  const dhEvento = formatarDataSefaz(undefined, ufEmitente);

  return (
    `<envEvento xmlns="${SEFAZ_NS}" versao="1.00">` +
    `<idLote>${loteId}</idLote>` +
    `<evento versao="1.00">` +
    `<infEvento Id="${idEvento}">` +
    `<cOrgao>${cUF}</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${chaveAcesso}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${protocolo}</nProt>` +
    `<xJust>${escapeXml(justificativa)}</xJust>` +
    `</detEvento>` +
    `</infEvento>` +
    `</evento>` +
    `</envEvento>`
  );
}

export interface EventoCCeInput {
  chaveAcesso: string;
  correcao: string;
  sequencia?: number;
  ufEmitente: string;
  tpAmb: '1' | '2';
  loteId: string;
}

export function buildEventoCCeXml(input: EventoCCeInput): string {
  const { chaveAcesso, correcao, sequencia = 1, ufEmitente, tpAmb, loteId } = input;
  const cUF = chaveAcesso.substring(0, 2);
  const cnpj = chaveAcesso.substring(6, 20);
  const tpEvento = '110110';
  const nSeqEvento = String(sequencia);
  const idEvento = `ID${tpEvento}${chaveAcesso}${nSeqEvento.padStart(2, '0')}`;
  const dhEvento = formatarDataSefaz(undefined, ufEmitente);

  const xCondUso =
    'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, ' +
    'de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de ' +
    'documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o ' +
    'valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da ' +
    'operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ' +
    'ou do destinatario; III - a data de emissao ou de saida.';

  return (
    `<envEvento xmlns="${SEFAZ_NS}" versao="1.00">` +
    `<idLote>${loteId}</idLote>` +
    `<evento versao="1.00">` +
    `<infEvento Id="${idEvento}">` +
    `<cOrgao>${cUF}</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${chaveAcesso}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>Carta de Correcao</descEvento>` +
    `<xCorrecao>${escapeXml(correcao)}</xCorrecao>` +
    `<xCondUso>${xCondUso}</xCondUso>` +
    `</detEvento>` +
    `</infEvento>` +
    `</evento>` +
    `</envEvento>`
  );
}

export interface InutilizacaoInput {
  cnpj: string;
  cUF: string;
  ano: string;
  modelo: '55' | '65';
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  tpAmb: '1' | '2';
}

export function buildInutNFeXml(input: InutilizacaoInput): string {
  const { cnpj, cUF, ano, modelo, serie, numeroInicial, numeroFinal, justificativa, tpAmb } =
    input;
  const seriePad = serie.padStart(3, '0');
  const nNFIni = String(numeroInicial).padStart(9, '0');
  const nNFFin = String(numeroFinal).padStart(9, '0');
  const idInut = `ID${cUF}${ano}${cnpj}${modelo}${seriePad}${nNFIni}${nNFFin}`;

  return (
    `<inutNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
    `<infInut Id="${idInut}">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<xServ>INUTILIZAR</xServ>` +
    `<cUF>${cUF}</cUF>` +
    `<ano>${ano}</ano>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<mod>${modelo}</mod>` +
    `<serie>${serie}</serie>` +
    `<nNFIni>${String(numeroInicial)}</nNFIni>` +
    `<nNFFin>${String(numeroFinal)}</nNFFin>` +
    `<xJust>${escapeXml(justificativa)}</xJust>` +
    `</infInut>` +
    `</inutNFe>`
  );
}

// --- Payload validation ---

function validateTaxCalc(
  bc: number | undefined,
  aliq: number | undefined,
  valor: number | undefined,
  tolerance = 0.01,
): boolean {
  if (bc === undefined || aliq === undefined || valor === undefined) return true;
  return Math.abs((bc * aliq) / 100 - valor) <= tolerance;
}

export function validateNFePayload(req: NFeRequest): string[] {
  const errors: string[] = [];
  if (!req.numero) errors.push('Número da NF-e é obrigatório');
  if (!req.ufEmitente || !/^[A-Z]{2}$/.test(req.ufEmitente)) errors.push('UF do emitente inválida');

  if (!req.emitente) {
    errors.push('Dados do emitente são obrigatórios');
  } else {
    if (!req.emitente.cnpj) errors.push('CNPJ do emitente é obrigatório');
    if (!req.emitente.inscricaoEstadual) errors.push('IE do emitente é obrigatória');
    if (!['1', '2', '3'].includes(req.emitente.crt)) errors.push('CRT do emitente inválido');
  }

  if (!req.destinatario) {
    errors.push('Dados do destinatário são obrigatórios');
  } else if (!req.destinatario.cnpj && !req.destinatario.cpf && !req.destinatario.idEstrangeiro) {
    errors.push('Destinatário deve ter CNPJ, CPF ou ID estrangeiro');
  }

  validateItens(req.itens, req.emitente?.crt, errors);

  if (!req.pagamento || !req.pagamento.formas?.length) {
    errors.push('Formas de pagamento são obrigatórias');
  }
  return errors;
}

export function validateNFCePayload(req: NFCeRequest): string[] {
  const errors: string[] = [];
  if (!req.numero) errors.push('Número da NFC-e é obrigatório');
  if (!req.ufEmitente || !/^[A-Z]{2}$/.test(req.ufEmitente)) errors.push('UF do emitente inválida');

  if (!req.emitente) {
    errors.push('Dados do emitente são obrigatórios');
  } else {
    if (!req.emitente.cnpj) errors.push('CNPJ do emitente é obrigatório');
    if (!req.emitente.inscricaoEstadual) errors.push('IE do emitente é obrigatória');
    if (!['1', '2', '3'].includes(req.emitente.crt)) errors.push('CRT do emitente inválido');
  }

  if (!req.csc?.id || !req.csc?.token) {
    errors.push('CSC (Código de Segurança do Contribuinte) é obrigatório para NFC-e');
  }

  validateItens(req.itens, req.emitente?.crt, errors);

  if (!req.pagamento?.formas?.length) errors.push('Formas de pagamento são obrigatórias');
  return errors;
}

function validateItens(itens: NFeRequest['itens'] | undefined, crt: string | undefined, errors: string[]): void {
  if (!itens || itens.length === 0) {
    errors.push('Documento deve ter ao menos 1 item');
    return;
  }
  itens.forEach((item, i) => {
    const idx = i + 1;
    if (!item.produto) {
      errors.push(`Item ${idx}: dados do produto são obrigatórios`);
      return;
    }
    const p = item.produto;
    if (!p.ncm || !/^\d{8}$/.test(p.ncm)) errors.push(`Item ${idx}: NCM inválido`);
    if (!p.cfop || !/^\d{4}$/.test(p.cfop)) errors.push(`Item ${idx}: CFOP inválido`);
    if (p.cest && !/^\d{7}$/.test(p.cest)) errors.push(`Item ${idx}: CEST inválido`);
    if (!p.descricao?.trim()) errors.push(`Item ${idx}: descrição obrigatória`);
    if (!p.quantidade || p.quantidade <= 0) errors.push(`Item ${idx}: quantidade > 0`);
    if (p.valorUnitario === undefined || p.valorUnitario < 0) errors.push(`Item ${idx}: valor unitário inválido`);

    if (!item.imposto?.icms) {
      errors.push(`Item ${idx}: dados de ICMS obrigatórios`);
    } else {
      const icms = item.imposto.icms;
      if (!icms.orig || !/^[0-7]$/.test(icms.orig)) errors.push(`Item ${idx}: origem ICMS inválida`);
      if (crt === '1' || crt === '2') {
        if (!icms.csosn) errors.push(`Item ${idx}: CSOSN obrigatório para Simples Nacional`);
      } else if (crt === '3') {
        if (!icms.cst) errors.push(`Item ${idx}: CST ICMS obrigatório para Regime Normal`);
      }
      if (icms.valorBC && icms.aliquota !== undefined && icms.valor !== undefined) {
        if (!validateTaxCalc(icms.valorBC, icms.aliquota, icms.valor)) {
          errors.push(`Item ${idx}: valor ICMS inconsistente`);
        }
      }
    }

    if (!item.imposto?.pis?.cst) errors.push(`Item ${idx}: CST do PIS obrigatório`);
    if (!item.imposto?.cofins?.cst) errors.push(`Item ${idx}: CST do COFINS obrigatório`);
  });
}
