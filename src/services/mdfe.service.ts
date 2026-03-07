// ============================================================
// MDF-e SERVICE - Orquestra operações MDF-e com SEFAZ
// ============================================================

import {
  buildMdfeXml,
  buildMdfeEventoEncerramento,
  buildMdfeEventoCancelamento,
  buildMdfeEventoInclusaoCondutor,
  buildMdfeEventoInclusaoDFe,
} from '../lib/mdfe/xml-builder';
import { assinarXml, assinarEvento } from '../lib/sefaz/xml-signer';
import { enviarSoap, extrairRetorno } from '../lib/sefaz/soap-client';
import { getMDFeEndpoints } from '../lib/sefaz/endpoints';
import {
  montarChaveAcesso,
  UF_CODES,
  gerarCodigoNumerico,
  apenasNumeros,
  formatarDataSefaz,
} from '../lib/utils';
import { config, getTpAmb } from '../config';
import type {
  MdfeRequest,
  MdfeEncerrarRequest,
  MdfeCancelarRequest,
  CertificateData,
  SefazResponse,
  TpAmb,
} from '../types';

// ============================================================
// Emissão (Recepção Síncrona)
// ============================================================

/**
 * Emite um MDF-e: constrói XML, assina e envia ao SEFAZ via recepção síncrona.
 */
export async function emitirMdfe(request: MdfeRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;
    const endpoints = getMDFeEndpoints(ambiente);

    const serie = request.serie || '1';
    if (!request.numero) {
      return {
        success: false,
        status: 'erro' as const,
        codigoStatus: '0',
        motivoStatus: 'numero do MDF-e é obrigatório (deve ser sequencial, controlado pelo emissor)',
        erros: ['numero não informado'],
      };
    }
    const numero = request.numero;
    const codigoNumerico = gerarCodigoNumerico();

    const cUF = UF_CODES[request.ufInicio.toUpperCase()];
    if (!cUF) {
      return {
        success: false,
        status: 'erro',
        codigoStatus: '0',
        motivoStatus: `UF de início inválida: ${request.ufInicio}`,
        erros: [`UF não encontrada: ${request.ufInicio}`],
      };
    }

    // Montar chave de acesso (44 dígitos)
    const chaveAcesso = montarChaveAcesso({
      cUF,
      dataEmissao: new Date(),
      cnpj: request.emitente.cnpj,
      modelo: '58',
      serie,
      numero,
      tipoEmissao: '1', // Normal
      codigoNumerico,
    });

    // Construir XML
    const xml = buildMdfeXml(request, chaveAcesso, numero, tpAmb);

    // Assinar XML
    const xmlAssinado = assinarXml(xml, request.certificado, 'infMDFe');

    // Montar corpo SOAP para recepção síncrona
    const soapBody = `<mdfeRecepcaoSinc xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoSinc">
  <mdfeDadosMsg>${xmlAssinado}</mdfeDadosMsg>
</mdfeRecepcaoSinc>`;

    // Enviar ao SEFAZ
    const soapResponse = await enviarSoap(
      endpoints.recepcao,
      'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoSinc/mdfeRecepcaoSinc',
      soapBody,
      request.certificado,
    );

    // Extrair retorno
    const retorno = extrairRetorno(soapResponse);

    return parseMdfeRetorno(retorno, chaveAcesso, xmlAssinado);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: '0',
      motivoStatus: error.message || 'Erro desconhecido na emissão do MDF-e',
      erros: [error.message],
    };
  }
}

// ============================================================
// Consulta
// ============================================================

/**
 * Consulta a situação de um MDF-e pelo sua chave de acesso.
 */
export async function consultarMdfe(
  chaveAcesso: string,
  certificado: CertificateData,
): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;
    const endpoints = getMDFeEndpoints(ambiente);

    const consultaXml = `<consSitMDFe xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00">
  <tpAmb>${tpAmb}</tpAmb>
  <xServ>CONSULTAR</xServ>
  <chMDFe>${chaveAcesso}</chMDFe>
</consSitMDFe>`;

    const soapBody = `<mdfeConsultaMDFe xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeConsulta">
  <mdfeDadosMsg>${consultaXml}</mdfeDadosMsg>
</mdfeConsultaMDFe>`;

    const soapResponse = await enviarSoap(
      endpoints.consulta,
      'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeConsulta/mdfeConsultaMDFe',
      soapBody,
      certificado,
    );

    const retorno = extrairRetorno(soapResponse);

    return parseConsultaRetorno(retorno, chaveAcesso);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: '0',
      motivoStatus: error.message || 'Erro desconhecido na consulta do MDF-e',
      erros: [error.message],
    };
  }
}

// ============================================================
// Encerramento
// ============================================================

/**
 * Encerra um MDF-e autorizado (evento 110112).
 */
export async function encerrarMdfe(request: MdfeEncerrarRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;
    const endpoints = getMDFeEndpoints(ambiente);

    // Extrair CNPJ da chave de acesso (posições 6-19)
    const cnpj = request.chaveAcesso.substring(6, 20);

    const eventoXml = buildMdfeEventoEncerramento({
      chaveAcesso: request.chaveAcesso,
      cnpj,
      protocolo: request.protocolo,
      codigoMunicipio: request.codigoMunicipio,
      uf: request.uf,
      dataEncerramento: request.dataEncerramento,
      tpAmb,
    });

    const xmlAssinado = assinarEvento(eventoXml, request.certificado);

    const soapBody = `<mdfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoEvento">
  <mdfeDadosMsg>${xmlAssinado}</mdfeDadosMsg>
</mdfeRecepcaoEvento>`;

    const soapResponse = await enviarSoap(
      endpoints.recepcaoEvento,
      'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoEvento/mdfeRecepcaoEvento',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);

    return parseEventoRetorno(retorno, request.chaveAcesso, xmlAssinado);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: '0',
      motivoStatus: error.message || 'Erro desconhecido no encerramento do MDF-e',
      erros: [error.message],
    };
  }
}

// ============================================================
// Cancelamento
// ============================================================

/**
 * Cancela um MDF-e autorizado (evento 110111).
 */
export async function cancelarMdfe(request: MdfeCancelarRequest): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;
    const endpoints = getMDFeEndpoints(ambiente);

    // Extrair CNPJ da chave de acesso (posições 6-19)
    const cnpj = request.chaveAcesso.substring(6, 20);

    // Validar justificativa (15-255 caracteres)
    if (request.justificativa.length < 15 || request.justificativa.length > 255) {
      return {
        success: false,
        status: 'erro',
        codigoStatus: '0',
        motivoStatus: 'Justificativa deve ter entre 15 e 255 caracteres',
        erros: ['Justificativa fora do tamanho permitido (15-255 caracteres)'],
      };
    }

    const eventoXml = buildMdfeEventoCancelamento({
      chaveAcesso: request.chaveAcesso,
      cnpj,
      protocolo: request.protocolo,
      justificativa: request.justificativa,
      tpAmb,
    });

    const xmlAssinado = assinarEvento(eventoXml, request.certificado);

    const soapBody = `<mdfeRecepcaoEvento xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoEvento">
  <mdfeDadosMsg>${xmlAssinado}</mdfeDadosMsg>
</mdfeRecepcaoEvento>`;

    const soapResponse = await enviarSoap(
      endpoints.recepcaoEvento,
      'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeRecepcaoEvento/mdfeRecepcaoEvento',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);

    return parseEventoRetorno(retorno, request.chaveAcesso, xmlAssinado);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: '0',
      motivoStatus: error.message || 'Erro desconhecido no cancelamento do MDF-e',
      erros: [error.message],
    };
  }
}

// ============================================================
// Status do Serviço
// ============================================================

/**
 * Consulta o status do serviço MDF-e no SEFAZ.
 */
export async function statusServico(certificado: CertificateData): Promise<SefazResponse> {
  try {
    const tpAmb = getTpAmb();
    const ambiente = config.sefazAmbiente;
    const endpoints = getMDFeEndpoints(ambiente);

    const statusXml = `<consStatServMDFe xmlns="http://www.portalfiscal.inf.br/mdfe" versao="3.00">
  <tpAmb>${tpAmb}</tpAmb>
  <xServ>STATUS</xServ>
</consStatServMDFe>`;

    const soapBody = `<mdfeStatusServico xmlns="http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeStatusServico">
  <mdfeDadosMsg>${statusXml}</mdfeDadosMsg>
</mdfeStatusServico>`;

    const soapResponse = await enviarSoap(
      endpoints.statusServico,
      'http://www.portalfiscal.inf.br/mdfe/wsdl/MDFeStatusServico/mdfeStatusServico',
      soapBody,
      certificado,
    );

    const retorno = extrairRetorno(soapResponse);

    // Extrair dados do retorno de status
    const ret = retorno?.retConsStatServMDFe || retorno;
    const cStat = String(ret?.cStat || '0');
    const xMotivo = String(ret?.xMotivo || 'Resposta não reconhecida');

    return {
      success: cStat === '107', // 107 = Serviço em operação
      status: cStat === '107' ? 'autorizado' : 'erro',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: '0',
      motivoStatus: error.message || 'Erro desconhecido ao consultar status do serviço',
      erros: [error.message],
    };
  }
}

// ============================================================
// Helpers - Parse de retornos SEFAZ
// ============================================================

/**
 * Interpreta o retorno da emissão (recepção síncrona) do MDF-e.
 */
function parseMdfeRetorno(
  retorno: any,
  chaveAcesso: string,
  xmlAssinado: string,
): SefazResponse {
  // O retorno síncrono vem em retMDFe
  const ret = retorno?.retMDFe || retorno;

  const cStat = String(ret?.cStat || '0');
  const xMotivo = String(ret?.xMotivo || 'Resposta não reconhecida');
  const nProt = ret?.protMDFe?.infProt?.nProt || ret?.infProt?.nProt;
  const dhRecbto = ret?.protMDFe?.infProt?.dhRecbto || ret?.infProt?.dhRecbto;

  // Status 100 = Autorizado
  if (cStat === '100') {
    return {
      success: true,
      status: 'autorizado',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: nProt ? String(nProt) : undefined,
      dataRecebimento: dhRecbto ? String(dhRecbto) : undefined,
      xml: xmlAssinado,
    };
  }

  // Status 101 = Cancelamento homologado (não deve ocorrer aqui, mas tratamos)
  // Status 103-105 = Lote recebido / em processamento
  if (['103', '104', '105'].includes(cStat)) {
    return {
      success: false,
      status: 'processando',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
    };
  }

  // Status 301-302 = Denegado
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

  // Qualquer outro status = Rejeitado
  return {
    success: false,
    status: 'rejeitado',
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: [xMotivo],
  };
}

/**
 * Interpreta o retorno de consulta do MDF-e.
 */
function parseConsultaRetorno(retorno: any, chaveAcesso: string): SefazResponse {
  const ret = retorno?.retConsSitMDFe || retorno;

  const cStat = String(ret?.cStat || '0');
  const xMotivo = String(ret?.xMotivo || 'Resposta não reconhecida');
  const nProt = ret?.protMDFe?.infProt?.nProt || ret?.infProt?.nProt;
  const dhRecbto = ret?.protMDFe?.infProt?.dhRecbto || ret?.infProt?.dhRecbto;

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
    erros: [xMotivo],
  };
}

/**
 * Interpreta o retorno de eventos (cancelamento, encerramento, etc.).
 */
function parseEventoRetorno(
  retorno: any,
  chaveAcesso: string,
  xmlAssinado: string,
): SefazResponse {
  // O retorno de eventos pode vir em retEventoMDFe
  const ret = retorno?.retEventoMDFe || retorno;
  const infEvento = ret?.infEvento || ret;

  const cStat = String(infEvento?.cStat || '0');
  const xMotivo = String(infEvento?.xMotivo || 'Resposta não reconhecida');
  const nProt = infEvento?.nProt;
  const dhRegEvento = infEvento?.dhRegEvento;

  // 135 = Evento registrado e vinculado
  // 136 = Evento registrado mas não vinculado
  if (cStat === '135' || cStat === '136') {
    return {
      success: true,
      status: 'autorizado',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: nProt ? String(nProt) : undefined,
      dataRecebimento: dhRegEvento ? String(dhRegEvento) : undefined,
      xml: xmlAssinado,
    };
  }

  return {
    success: false,
    status: 'rejeitado',
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: [xMotivo],
  };
}
