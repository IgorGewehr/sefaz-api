// ============================================================
// NFe/NFCe Service - Orquestração de emissão fiscal
// ============================================================

import { buildNFeXml, buildNFCeXml, buildNFCeSupl } from '../lib/nfe/xml-builder';
import { assinarXml, assinarEvento, assinarInutilizacao } from '../lib/sefaz/xml-signer';
import { enviarSoap, extrairRetorno } from '../lib/sefaz/soap-client';
import { getNFeEndpoints, getNFCeEndpoints } from '../lib/sefaz/endpoints';
import {
  UF_CODES,
  gerarCodigoNumerico,
  montarChaveAcesso,
  gerarIdLote,
  formatarDataSefaz,
  formatarValor,
  apenasNumeros,
  escapeXml,
} from '../lib/utils';
import { config, getTpAmb } from '../config';
import type {
  NFeRequest,
  NFCeRequest,
  NFeConsultaRequest,
  NFeCancelarRequest,
  NFeCartaCorrecaoRequest,
  NFeInutilizarRequest,
  StatusServicoRequest,
  SefazResponse,
  CertificateData,
  TpAmb,
} from '../types';

// ============================================================
// Constantes
// ============================================================

const SEFAZ_NS = 'http://www.portalfiscal.inf.br/nfe';
const AUTORIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4';
const RET_AUTORIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4';
const CONSULTA_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4';
const STATUS_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4';
const RECEPCAO_EVENTO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const INUTILIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4';

const MAX_POLLING_ATTEMPTS = 10;
const POLLING_INTERVAL_MS = 3000;

// ============================================================
// Helpers
// ============================================================

/**
 * Pausa execução por ms milissegundos
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Interpreta o status da SEFAZ e retorna o status padronizado
 */
function interpretarStatus(cStat: string): SefazResponse['status'] {
  const code = parseInt(cStat, 10);

  // 100 = Autorizada, 150 = Autorizada fora de prazo
  if (code === 100 || code === 150) return 'autorizado';

  // 105 = Lote em processamento
  if (code === 105) return 'processando';

  // 110 = Uso denegado
  if (code === 110 || code === 301 || code === 302 || code === 303) return 'denegado';

  // 135 = Evento registrado e vinculado
  if (code === 135 || code === 136) return 'autorizado';

  // 101 = Cancelamento homologado
  if (code === 101) return 'autorizado';

  // 102 = Inutilização homologada
  if (code === 102) return 'autorizado';

  // 107 = Serviço em operação
  if (code === 107) return 'autorizado';

  // Rejeições (200-999)
  if (code >= 200) return 'rejeitado';

  return 'erro';
}

/**
 * Extrai dados relevantes do retorno da autorização
 */
function parseRetAutorizacao(retorno: any): SefazResponse {
  // Pode vir como retEnviNFe ou retConsReciNFe
  const ret = retorno['retEnviNFe'] || retorno['retConsReciNFe'] || retorno;

  const cStat = String(ret['cStat'] || '');
  const xMotivo = String(ret['xMotivo'] || '');

  // Se cStat=104, verificar protNFe individual
  if (cStat === '104' || ret['protNFe']) {
    const protNFe = ret['protNFe'];
    if (protNFe) {
      const infProt = protNFe['infProt'] || protNFe;
      const protStat = String(infProt['cStat'] || '');
      const protMotivo = String(infProt['xMotivo'] || '');

      return {
        success: protStat === '100' || protStat === '150',
        status: interpretarStatus(protStat),
        codigoStatus: protStat,
        motivoStatus: protMotivo,
        chaveAcesso: String(infProt['chNFe'] || ''),
        protocolo: String(infProt['nProt'] || ''),
        dataRecebimento: String(infProt['dhRecbto'] || ''),
      };
    }
  }

  // Resposta síncrona (NFCe indSinc=1) com cStat=100
  if (cStat === '100' || cStat === '150') {
    const protNFe = ret['protNFe'];
    if (protNFe) {
      const infProt = protNFe['infProt'] || protNFe;
      return {
        success: true,
        status: 'autorizado',
        codigoStatus: String(infProt['cStat'] || cStat),
        motivoStatus: String(infProt['xMotivo'] || xMotivo),
        chaveAcesso: String(infProt['chNFe'] || ''),
        protocolo: String(infProt['nProt'] || ''),
        dataRecebimento: String(infProt['dhRecbto'] || ''),
      };
    }
  }

  // Lote em processamento
  if (cStat === '103' || cStat === '105') {
    return {
      success: false,
      status: 'processando',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      nRec: String(ret['infRec']?.['nRec'] || ''),
    };
  }

  // Retorno com recibo (para polling)
  if (ret['infRec']) {
    return {
      success: false,
      status: 'processando',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      nRec: String(ret['infRec']['nRec'] || ''),
    };
  }

  return {
    success: false,
    status: interpretarStatus(cStat),
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    erros: [xMotivo],
  };
}

/**
 * Envolve a NFe assinada no envelope enviNFe para autorização
 */
function wrapEnviNFe(signedXml: string, loteId: string, indSinc: '0' | '1'): string {
  // Extrair apenas o conteúdo <NFe>...</NFe> do XML assinado
  const nfeMatch = signedXml.match(/<NFe\s[^]*<\/NFe>/);
  if (!nfeMatch) {
    throw new Error('Não foi possível extrair o elemento NFe do XML assinado');
  }
  const nfeContent = nfeMatch[0];

  return `<nfeDadosMsg xmlns="${AUTORIZACAO_NS}">` +
    `<enviNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
    `<idLote>${loteId}</idLote>` +
    `<indSinc>${indSinc}</indSinc>` +
    nfeContent +
    `</enviNFe>` +
    `</nfeDadosMsg>`;
}

/**
 * Gera chave de acesso e número para uma nota
 */
function gerarChaveENumero(params: {
  ufEmitente: string;
  cnpj: string;
  modelo: '55' | '65';
  serie: string;
  numero?: number;
}): { chaveAcesso: string; numero: number; codigoNumerico: string } {
  const { ufEmitente, cnpj, modelo, serie } = params;

  const cUF = UF_CODES[ufEmitente.toUpperCase()];
  if (!cUF) {
    throw new Error(`UF inválida: ${ufEmitente}`);
  }

  const codigoNumerico = gerarCodigoNumerico();
  if (!params.numero) {
    throw new Error('numero da nota é obrigatório (deve ser sequencial, controlado pelo emissor)');
  }
  const numero = params.numero;

  const chaveAcesso = montarChaveAcesso({
    cUF,
    dataEmissao: new Date(),
    cnpj: apenasNumeros(cnpj),
    modelo,
    serie,
    numero,
    tipoEmissao: '1',
    codigoNumerico,
  });

  return { chaveAcesso, numero, codigoNumerico };
}

// ============================================================
// Funções principais do serviço
// ============================================================

/**
 * Emite uma NFe (modelo 55) - assíncrono com polling
 */
export async function emitirNFe(request: NFeRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;
    const serie = request.serie || '1';

    // 1. Gerar chave de acesso
    const { chaveAcesso, numero } = gerarChaveENumero({
      ufEmitente: request.ufEmitente,
      cnpj: request.emitente.cnpj,
      modelo: '55',
      serie,
      numero: request.numero,
    });

    // 2. Construir o XML da NFe
    const nfeXml = buildNFeXml(request, chaveAcesso, numero, tpAmb);

    // 3. Assinar o XML
    const signedXml = assinarXml(nfeXml, request.certificado, 'infNFe');

    // 4. Envelopar no enviNFe (assíncrono: indSinc=0)
    const loteId = gerarIdLote();
    const soapBody = wrapEnviNFe(signedXml, loteId, '0');

    // 5. Obter endpoint e enviar
    const endpoints = getNFeEndpoints(request.ufEmitente, ambiente);
    const soapResponse = await enviarSoap(
      endpoints.autorizacao,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
      soapBody,
      request.certificado,
    );

    // 6. Parsear resposta inicial
    const retorno = extrairRetorno(soapResponse);
    const resultado = parseRetAutorizacao(retorno);

    // 7. Se está processando, fazer polling
    if (resultado.status === 'processando' && resultado.nRec) {
      const nRec = resultado.nRec;
      const pollingResult = await pollRetAutorizacao(
        nRec,
        request.ufEmitente,
        ambiente,
        request.certificado,
      );

      // Complementar com a chave de acesso gerada caso não tenha vindo no retorno
      if (pollingResult.success && !pollingResult.chaveAcesso) {
        pollingResult.chaveAcesso = chaveAcesso;
      }

      // Incluir XML assinado na resposta se autorizado
      if (pollingResult.success) {
        pollingResult.xml = signedXml;
      }

      return pollingResult;
    }

    // Se já tem resultado definitivo
    if (resultado.success) {
      resultado.xml = signedXml;
      if (!resultado.chaveAcesso) {
        resultado.chaveAcesso = chaveAcesso;
      }
    }

    return resultado;
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro desconhecido ao emitir NFe',
      erros: [error.message],
    };
  }
}

/**
 * Polling de retorno da autorização (NFe assíncrona)
 */
async function pollRetAutorizacao(
  nRec: string,
  ufEmitente: string,
  ambiente: 'producao' | 'homologacao',
  certificado: CertificateData,
): Promise<SefazResponse> {
  const tpAmb = ambiente === 'producao' ? '1' : '2';
  const endpoints = getNFeEndpoints(ufEmitente, ambiente);

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    await sleep(POLLING_INTERVAL_MS);

    const soapBody =
      `<nfeDadosMsg xmlns="${RET_AUTORIZACAO_NS}">` +
      `<consReciNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<nRec>${nRec}</nRec>` +
      `</consReciNFe>` +
      `</nfeDadosMsg>`;

    try {
      const soapResponse = await enviarSoap(
        endpoints.retAutorizacao,
        'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4/nfeRetAutorizacaoLote',
        soapBody,
        certificado,
      );

      const retorno = extrairRetorno(soapResponse);
      const resultado = parseRetAutorizacao(retorno);

      // Se não está mais processando, retornar
      if (resultado.status !== 'processando') {
        return resultado;
      }
    } catch (error: any) {
      // Continuar tentando em caso de erro transitório
      if (attempt === MAX_POLLING_ATTEMPTS - 1) {
        return {
          success: false,
          status: 'erro',
          codigoStatus: 'TIMEOUT',
          motivoStatus: `Timeout ao consultar retorno após ${MAX_POLLING_ATTEMPTS} tentativas: ${error.message}`,
          erros: [error.message],
        };
      }
    }
  }

  return {
    success: false,
    status: 'processando',
    codigoStatus: '105',
    motivoStatus: 'Lote ainda em processamento após todas as tentativas de polling',
  };
}

/**
 * Emite uma NFCe (modelo 65) - síncrono (indSinc=1)
 */
export async function emitirNFCe(request: NFCeRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;
    const serie = request.serie || '1';

    // 1. Gerar chave de acesso
    const { chaveAcesso, numero } = gerarChaveENumero({
      ufEmitente: request.ufEmitente,
      cnpj: request.emitente.cnpj,
      modelo: '65',
      serie,
      numero: request.numero,
    });

    // 2. Construir o XML da NFCe
    const nfceXml = buildNFCeXml(request, chaveAcesso, numero, tpAmb);

    // 3. Assinar o XML
    let signedXml = assinarXml(nfceXml, request.certificado, 'infNFe');

    // 4. Inserir infNFeSupl após assinatura (deve ficar entre Signature e </NFe>)
    const nfceSupl = buildNFCeSupl(chaveAcesso, tpAmb, request.csc, request.ufEmitente);
    signedXml = signedXml.replace('</NFe>', `${nfceSupl}</NFe>`);

    // 5. Envelopar no enviNFe (síncrono: indSinc=1)
    const loteId = gerarIdLote();
    const soapBody = wrapEnviNFe(signedXml, loteId, '1');

    // 6. Obter endpoint e enviar
    const endpoints = getNFCeEndpoints(request.ufEmitente, ambiente);
    const soapResponse = await enviarSoap(
      endpoints.autorizacao,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
      soapBody,
      request.certificado,
    );

    // 7. Parsear resposta (síncrona - resultado imediato)
    const retorno = extrairRetorno(soapResponse);
    const resultado = parseRetAutorizacao(retorno);

    if (resultado.success) {
      resultado.xml = signedXml;
      if (!resultado.chaveAcesso) {
        resultado.chaveAcesso = chaveAcesso;
      }
    }

    return resultado;
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro desconhecido ao emitir NFCe',
      erros: [error.message],
    };
  }
}

/**
 * Consulta o protocolo de uma NFe/NFCe pela chave de acesso
 */
export async function consultarProtocolo(request: NFeConsultaRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;

    const soapBody =
      `<nfeDadosMsg xmlns="${CONSULTA_NS}">` +
      `<consSitNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<xServ>CONSULTAR</xServ>` +
      `<chNFe>${request.chaveAcesso}</chNFe>` +
      `</consSitNFe>` +
      `</nfeDadosMsg>`;

    // Determinar modelo pela posição 20-21 da chave (55=NFe, 65=NFCe)
    const modelo = request.chaveAcesso.substring(20, 22);
    const endpoints = modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.consultaProtocolo,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    const ret = retorno['retConsSitNFe'] || retorno;

    const cStat = String(ret['cStat'] || '');
    const xMotivo = String(ret['xMotivo'] || '');

    // Verificar protocolo
    const protNFe = ret['protNFe'];
    if (protNFe) {
      const infProt = protNFe['infProt'] || protNFe;
      const protStat = String(infProt['cStat'] || cStat);
      return {
        success: protStat === '100' || protStat === '150',
        status: interpretarStatus(protStat),
        codigoStatus: protStat,
        motivoStatus: String(infProt['xMotivo'] || xMotivo),
        chaveAcesso: request.chaveAcesso,
        protocolo: String(infProt['nProt'] || ''),
        dataRecebimento: String(infProt['dhRecbto'] || ''),
      };
    }

    return {
      success: false,
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso: request.chaveAcesso,
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao consultar protocolo',
      erros: [error.message],
    };
  }
}

/**
 * Cancela uma NFe/NFCe
 * Evento tipo 110111
 */
export async function cancelarNFe(request: NFeCancelarRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;

    const chave = request.chaveAcesso;
    const cUF = chave.substring(0, 2);
    const cnpj = chave.substring(6, 20);
    const tpEvento = '110111';
    const nSeqEvento = '1';
    const idEvento = `ID${tpEvento}${chave}${nSeqEvento.padStart(2, '0')}`;
    const dhEvento = formatarDataSefaz(undefined, request.ufEmitente);
    const loteId = gerarIdLote();

    const eventoXml =
      `<envEvento xmlns="${SEFAZ_NS}" versao="1.00">` +
      `<idLote>${loteId}</idLote>` +
      `<evento versao="1.00">` +
      `<infEvento Id="${idEvento}">` +
      `<cOrgao>${cUF}</cOrgao>` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<CNPJ>${cnpj}</CNPJ>` +
      `<chNFe>${chave}</chNFe>` +
      `<dhEvento>${dhEvento}</dhEvento>` +
      `<tpEvento>${tpEvento}</tpEvento>` +
      `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00">` +
      `<descEvento>Cancelamento</descEvento>` +
      `<nProt>${request.protocolo}</nProt>` +
      `<xJust>${escapeXml(request.justificativa)}</xJust>` +
      `</detEvento>` +
      `</infEvento>` +
      `</evento>` +
      `</envEvento>`;

    // Assinar o evento
    const signedXml = assinarEvento(eventoXml, request.certificado);

    // Envelopar para SOAP
    const soapBody =
      `<nfeDadosMsg xmlns="${RECEPCAO_EVENTO_NS}">` +
      signedXml +
      `</nfeDadosMsg>`;

    // Determinar modelo pela posição 20-21 da chave
    const modelo = chave.substring(20, 22);
    const endpoints = modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.recepcaoEvento,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    return parseRetEvento(retorno, chave);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao cancelar NFe',
      erros: [error.message],
    };
  }
}

/**
 * Emite Carta de Correção (CCe) para uma NFe
 * Evento tipo 110110
 */
export async function cartaCorrecao(request: NFeCartaCorrecaoRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;

    const chave = request.chaveAcesso;
    const cUF = chave.substring(0, 2);
    const cnpj = chave.substring(6, 20);
    const tpEvento = '110110';
    const nSeqEvento = String(request.sequencia || 1);
    const idEvento = `ID${tpEvento}${chave}${nSeqEvento.padStart(2, '0')}`;
    const dhEvento = formatarDataSefaz(undefined, request.ufEmitente);
    const loteId = gerarIdLote();

    const xCondUso =
      'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, ' +
      'de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de ' +
      'documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o ' +
      'valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da ' +
      'operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ' +
      'ou do destinatario; III - a data de emissao ou de saida.';

    const eventoXml =
      `<envEvento xmlns="${SEFAZ_NS}" versao="1.00">` +
      `<idLote>${loteId}</idLote>` +
      `<evento versao="1.00">` +
      `<infEvento Id="${idEvento}">` +
      `<cOrgao>${cUF}</cOrgao>` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<CNPJ>${cnpj}</CNPJ>` +
      `<chNFe>${chave}</chNFe>` +
      `<dhEvento>${dhEvento}</dhEvento>` +
      `<tpEvento>${tpEvento}</tpEvento>` +
      `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00">` +
      `<descEvento>Carta de Correcao</descEvento>` +
      `<xCorrecao>${escapeXml(request.correcao)}</xCorrecao>` +
      `<xCondUso>${xCondUso}</xCondUso>` +
      `</detEvento>` +
      `</infEvento>` +
      `</evento>` +
      `</envEvento>`;

    // Assinar o evento
    const signedXml = assinarEvento(eventoXml, request.certificado);

    // Envelopar para SOAP
    const soapBody =
      `<nfeDadosMsg xmlns="${RECEPCAO_EVENTO_NS}">` +
      signedXml +
      `</nfeDadosMsg>`;

    const endpoints = getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.recepcaoEvento,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    return parseRetEvento(retorno, chave);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao emitir carta de correção',
      erros: [error.message],
    };
  }
}

/**
 * Inutiliza uma faixa de numeração de NFe/NFCe
 */
export async function inutilizar(request: NFeInutilizarRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;

    const cUF = UF_CODES[request.ufEmitente.toUpperCase()];
    if (!cUF) {
      throw new Error(`UF inválida: ${request.ufEmitente}`);
    }

    const cnpj = apenasNumeros(request.cnpj);
    const serie = request.serie.padStart(3, '0');
    const nNFIni = String(request.numeroInicial).padStart(9, '0');
    const nNFFin = String(request.numeroFinal).padStart(9, '0');

    // ID: ID + cUF(2) + ano(2) + CNPJ(14) + mod(2) + serie(3) + nNFIni(9) + nNFFin(9) = 43 dígitos
    const idInut = `ID${cUF}${request.ano}${cnpj}${request.modelo}${serie}${nNFIni}${nNFFin}`;

    const inutXml =
      `<inutNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<infInut Id="${idInut}">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<xServ>INUTILIZAR</xServ>` +
      `<cUF>${cUF}</cUF>` +
      `<ano>${request.ano}</ano>` +
      `<CNPJ>${cnpj}</CNPJ>` +
      `<mod>${request.modelo}</mod>` +
      `<serie>${request.serie}</serie>` +
      `<nNFIni>${String(request.numeroInicial)}</nNFIni>` +
      `<nNFFin>${String(request.numeroFinal)}</nNFFin>` +
      `<xJust>${escapeXml(request.justificativa)}</xJust>` +
      `</infInut>` +
      `</inutNFe>`;

    // Assinar
    const signedXml = assinarInutilizacao(inutXml, request.certificado);

    // Envelopar para SOAP
    const soapBody =
      `<nfeDadosMsg xmlns="${INUTILIZACAO_NS}">` +
      signedXml +
      `</nfeDadosMsg>`;

    const endpoints = request.modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.inutilizacao,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    const ret = retorno['retInutNFe'] || retorno;
    const infInut = ret['infInut'] || ret;

    const cStat = String(infInut['cStat'] || '');
    const xMotivo = String(infInut['xMotivo'] || '');

    return {
      success: cStat === '102',
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      protocolo: String(infInut['nProt'] || ''),
      dataRecebimento: String(infInut['dhRecbto'] || ''),
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao inutilizar numeração',
      erros: [error.message],
    };
  }
}

/**
 * Consulta o status do serviço SEFAZ
 */
export async function statusServico(request: StatusServicoRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;

    const cUF = UF_CODES[request.ufEmitente.toUpperCase()];
    if (!cUF) {
      throw new Error(`UF inválida: ${request.ufEmitente}`);
    }

    const soapBody =
      `<nfeDadosMsg xmlns="${STATUS_NS}">` +
      `<consStatServ xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<cUF>${cUF}</cUF>` +
      `<xServ>STATUS</xServ>` +
      `</consStatServ>` +
      `</nfeDadosMsg>`;

    const modelo = request.modelo || '55';
    const endpoints = modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.statusServico,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    const ret = retorno['retConsStatServ'] || retorno;

    const cStat = String(ret['cStat'] || '');
    const xMotivo = String(ret['xMotivo'] || '');

    return {
      success: cStat === '107',
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      dataRecebimento: String(ret['dhRecbto'] || ''),
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao consultar status do serviço',
      erros: [error.message],
    };
  }
}

// ============================================================
// Helpers de parsing de retorno de evento
// ============================================================

/**
 * Parseia o retorno de um evento (cancelamento, CCe)
 */
function parseRetEvento(retorno: any, chaveAcesso: string): SefazResponse {
  const ret = retorno['retEnvEvento'] || retorno;

  const cStatLote = String(ret['cStat'] || '');

  // Verificar retorno individual do evento
  const retEvento = ret['retEvento'];
  if (retEvento) {
    const infEvento = retEvento['infEvento'] || retEvento;
    const cStat = String(infEvento['cStat'] || cStatLote);
    const xMotivo = String(infEvento['xMotivo'] || '');

    return {
      success: cStat === '135' || cStat === '136' || cStat === '101',
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: String(infEvento['nProt'] || ''),
      dataRecebimento: String(infEvento['dhRegEvento'] || ''),
    };
  }

  const xMotivo = String(ret['xMotivo'] || '');

  return {
    success: false,
    status: interpretarStatus(cStatLote),
    codigoStatus: cStatLote,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: [xMotivo],
  };
}
