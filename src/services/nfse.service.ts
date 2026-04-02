// ============================================================
// NFS-e Service - Orquestração de emissão NFS-e Padrão Nacional
// ============================================================

import {
  buildEnviarLoteRpsXml,
  buildConsultarSituacaoLoteRpsXml,
  buildConsultarLoteRpsXml,
  buildConsultarNfseXml,
  buildCancelarNfseXml,
} from '../lib/nfse/xml-builder';
import { assinarXml } from '../lib/sefaz/xml-signer';
import { enviarSoap, extrairBodySoap, xmlParser } from '../lib/sefaz/soap-client';
import { getNfseEndpoints, NFSE_SOAP_ACTIONS } from '../lib/nfse/nfse-endpoints';
import { gerarIdLote, apenasNumeros } from '../lib/utils';
import { config } from '../config';
import type { CertificateData } from '../types';
import type {
  NfseEmitirRequest,
  NfseEnviarLoteRequest,
  NfseConsultarLoteRequest,
  NfseConsultarNfseRequest,
  NfseCancelarRequest,
  NfseResponse,
  NfseMensagemRetorno,
} from '../types/nfse';

// ============================================================
// Constantes
// ============================================================

const MAX_POLLING_ATTEMPTS = 10;
const POLLING_INTERVAL_MS = 3000;

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envelopa o XML de dados no SOAP 1.2 esperado pelo Padrão Nacional.
 * A NFS-e Padrão Nacional usa SOAP 1.2 (diferente da NFe que usa SOAP 1.1).
 */
function enveloparSoap12(xmlBody: string, soapAction: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    ${xmlBody}
  </soap12:Body>
</soap12:Envelope>`;
}

/**
 * Assina cada <InfDeclaracaoPrestacaoServico> individualmente dentro do XML do lote.
 * Itera sobre cada RPS no lote e aplica a assinatura enveloped.
 */
function assinarLoteRps(xml: string, certificado: CertificateData): string {
  // Encontrar todos os Ids de InfDeclaracaoPrestacaoServico
  const idRegex = /InfDeclaracaoPrestacaoServico[^>]*\s+Id="([^"]+)"/g;
  let match: RegExpExecArray | null;
  const ids: string[] = [];

  while ((match = idRegex.exec(xml)) !== null) {
    ids.push(match[1]);
  }

  // Assinar cada InfDeclaracaoPrestacaoServico
  let xmlAssinado = xml;
  for (const _id of ids) {
    xmlAssinado = assinarXml(xmlAssinado, certificado, 'InfDeclaracaoPrestacaoServico');
  }

  return xmlAssinado;
}

// ============================================================
// Emitir NFS-e (RPS único)
// ============================================================

/**
 * Emite uma NFS-e a partir de um RPS único.
 * Fluxo: Validar → Build XML → Assinar → SOAP 1.2 → Transmitir → Polling
 */
export async function emitirNfse(request: NfseEmitirRequest): Promise<NfseResponse> {
  try {
    const ambiente = config.sefazAmbiente;
    const endpoints = getNfseEndpoints(ambiente);
    const loteId = gerarIdLote();

    // Validação básica
    const erros = validarRps(request);
    if (erros.length > 0) {
      return {
        success: false,
        status: 'erro',
        mensagens: erros.map(e => ({ codigo: '0', mensagem: e })),
      };
    }

    // Build XML do lote (com 1 RPS)
    const xml = buildEnviarLoteRpsXml(
      loteId,
      request.prestador.cnpj,
      request.prestador.inscricaoMunicipal,
      [request],
    );

    // Assinar cada InfDeclaracaoPrestacaoServico
    const xmlAssinado = assinarLoteRps(xml, request.certificado);

    // Enviar via SOAP
    const soapResponse = await enviarSoap(
      endpoints.recepcionarLoteRps,
      NFSE_SOAP_ACTIONS.recepcionarLoteRps,
      xmlAssinado,
      request.certificado,
    );

    // Extrair retorno
    const body = extrairBodySoap(soapResponse);
    const retorno = extrairRetornoNfse(body);

    // Verificar se recebeu protocolo para polling
    const protocolo = retorno?.Protocolo || retorno?.NumeroLote;
    if (protocolo) {
      // Polling para obter resultado
      return await pollingLote(
        String(protocolo),
        request.prestador.cnpj,
        request.prestador.inscricaoMunicipal,
        request.certificado,
      );
    }

    // Retorno síncrono (autorizado direto ou erro)
    return parseRetornoEnvio(retorno);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      mensagens: [{ codigo: '0', mensagem: error.message || 'Erro desconhecido na emissão NFS-e' }],
    };
  }
}

// ============================================================
// Enviar Lote de RPS
// ============================================================

/**
 * Envia um lote de RPS (múltiplos).
 * Retorna o protocolo para consulta posterior.
 */
export async function enviarLoteRps(request: NfseEnviarLoteRequest): Promise<NfseResponse> {
  try {
    const ambiente = config.sefazAmbiente;
    const endpoints = getNfseEndpoints(ambiente);
    const loteId = gerarIdLote();

    // Build XML do lote
    const xml = buildEnviarLoteRpsXml(
      loteId,
      request.prestador.cnpj,
      request.prestador.inscricaoMunicipal,
      request.rps,
    );

    // Assinar todos os RPS
    const xmlAssinado = assinarLoteRps(xml, request.certificado);

    // Enviar
    const soapResponse = await enviarSoap(
      endpoints.recepcionarLoteRps,
      NFSE_SOAP_ACTIONS.recepcionarLoteRps,
      xmlAssinado,
      request.certificado,
    );

    const body = extrairBodySoap(soapResponse);
    const retorno = extrairRetornoNfse(body);

    return parseRetornoEnvio(retorno);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      mensagens: [{ codigo: '0', mensagem: error.message || 'Erro desconhecido no envio do lote' }],
    };
  }
}

// ============================================================
// Consultar Lote de RPS
// ============================================================

export async function consultarLoteRps(request: NfseConsultarLoteRequest): Promise<NfseResponse> {
  try {
    const ambiente = config.sefazAmbiente;
    const endpoints = getNfseEndpoints(ambiente);

    const xml = buildConsultarLoteRpsXml(request);

    const soapResponse = await enviarSoap(
      endpoints.consultarLoteRps,
      NFSE_SOAP_ACTIONS.consultarLoteRps,
      xml,
      request.certificado,
    );

    const body = extrairBodySoap(soapResponse);
    const retorno = extrairRetornoNfse(body);

    return parseRetornoConsultaLote(retorno);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na consulta do lote' }],
    };
  }
}

// ============================================================
// Consultar NFS-e
// ============================================================

export async function consultarNfse(request: NfseConsultarNfseRequest): Promise<NfseResponse> {
  try {
    const ambiente = config.sefazAmbiente;
    const endpoints = getNfseEndpoints(ambiente);

    const xml = buildConsultarNfseXml(request);

    const soapResponse = await enviarSoap(
      endpoints.consultarNfse,
      NFSE_SOAP_ACTIONS.consultarNfse,
      xml,
      request.certificado,
    );

    const body = extrairBodySoap(soapResponse);
    const retorno = extrairRetornoNfse(body);

    return parseRetornoConsultaLote(retorno);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na consulta de NFS-e' }],
    };
  }
}

// ============================================================
// Cancelar NFS-e
// ============================================================

export async function cancelarNfse(request: NfseCancelarRequest): Promise<NfseResponse> {
  try {
    const ambiente = config.sefazAmbiente;
    const endpoints = getNfseEndpoints(ambiente);

    // Build XML de cancelamento
    let xml = buildCancelarNfseXml(request);

    // Assinar InfPedidoCancelamento
    xml = assinarXml(xml, request.certificado, 'InfPedidoCancelamento');

    // Enviar
    const soapResponse = await enviarSoap(
      endpoints.cancelarNfse,
      NFSE_SOAP_ACTIONS.cancelarNfse,
      xml,
      request.certificado,
    );

    const body = extrairBodySoap(soapResponse);
    const retorno = extrairRetornoNfse(body);

    return parseRetornoCancelamento(retorno);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      mensagens: [{ codigo: '0', mensagem: error.message || 'Erro no cancelamento da NFS-e' }],
    };
  }
}

// ============================================================
// Polling assíncrono do lote
// ============================================================

async function pollingLote(
  protocolo: string,
  cnpj: string,
  inscricaoMunicipal: string,
  certificado: CertificateData,
): Promise<NfseResponse> {
  const ambiente = config.sefazAmbiente;
  const endpoints = getNfseEndpoints(ambiente);

  for (let attempt = 1; attempt <= MAX_POLLING_ATTEMPTS; attempt++) {
    await sleep(POLLING_INTERVAL_MS);

    try {
      const xml = buildConsultarSituacaoLoteRpsXml(
        protocolo,
        cnpj,
        inscricaoMunicipal,
      );

      const soapResponse = await enviarSoap(
        endpoints.consultarSituacaoLoteRps,
        NFSE_SOAP_ACTIONS.consultarSituacaoLoteRps,
        xml,
        certificado,
      );

      const body = extrairBodySoap(soapResponse);
      const retorno = extrairRetornoNfse(body);

      const situacao = String(retorno?.Situacao || '');

      // 1=Não Recebido, 2=Não Processado, 3=Processado com Erro, 4=Processado com Sucesso
      if (situacao === '4') {
        // Sucesso — buscar resultado completo
        return await consultarLoteRps({
          prestador: { cnpj, inscricaoMunicipal },
          protocolo,
          certificado,
        });
      }

      if (situacao === '3') {
        // Processado com erro
        return {
          success: false,
          status: 'rejeitado',
          protocolo,
          mensagens: extrairMensagens(retorno),
        };
      }

      // Situação 1 ou 2 — continuar polling
    } catch {
      // Erro de rede no polling — continuar tentando
    }
  }

  return {
    success: false,
    status: 'processando',
    protocolo,
    mensagens: [{ codigo: '0', mensagem: `Lote ainda em processamento após ${MAX_POLLING_ATTEMPTS} tentativas` }],
  };
}

// ============================================================
// Validação
// ============================================================

function validarRps(request: NfseEmitirRequest): string[] {
  const erros: string[] = [];

  if (!request.prestador?.cnpj) erros.push('CNPJ do prestador é obrigatório');
  if (!request.prestador?.inscricaoMunicipal) erros.push('Inscrição Municipal do prestador é obrigatória');
  if (!request.tomador?.nome) erros.push('Nome do tomador é obrigatório');
  if (!request.servico?.codigoServico) erros.push('Código do serviço (LC 116) é obrigatório');
  if (!request.servico?.discriminacao) erros.push('Discriminação do serviço é obrigatória');
  if (!request.servico?.codigoMunicipioPrestacao) erros.push('Código do município de prestação é obrigatório');
  if (!request.valores?.valorServicos || request.valores.valorServicos <= 0) {
    erros.push('Valor dos serviços deve ser maior que zero');
  }
  if (request.valores?.aliquotaIss === undefined || request.valores.aliquotaIss < 0) {
    erros.push('Alíquota ISS é obrigatória');
  }
  if (!request.rps?.numero) erros.push('Número do RPS é obrigatório');
  if (!request.rps?.serie) erros.push('Série do RPS é obrigatória');
  if (!request.rps?.dataEmissao) erros.push('Data de emissão do RPS é obrigatória');
  if (!request.certificado?.pfxBase64 || !request.certificado?.password) {
    erros.push('Certificado digital (pfxBase64 + password) é obrigatório');
  }

  return erros;
}

// ============================================================
// Parsers de retorno
// ============================================================

function extrairRetornoNfse(body: any): any {
  // Navegar pela estrutura do body SOAP procurando o conteúdo de retorno
  const keys = Object.keys(body);
  for (const key of keys) {
    const inner = body[key];
    if (inner && typeof inner === 'object') {
      // Retorno pode estar em diversas tags dependendo da operação
      for (const innerKey of Object.keys(inner)) {
        if (typeof inner[innerKey] === 'string') {
          // Parse XML embutido
          return xmlParser.parse(inner[innerKey]);
        }
        if (typeof inner[innerKey] === 'object') {
          return inner[innerKey];
        }
      }
      return inner;
    }
  }
  return body;
}

function extrairMensagens(retorno: any): NfseMensagemRetorno[] {
  const mensagens: NfseMensagemRetorno[] = [];

  const lista = retorno?.ListaMensagemRetorno?.MensagemRetorno;
  if (!lista) return mensagens;

  const items = Array.isArray(lista) ? lista : [lista];
  for (const item of items) {
    mensagens.push({
      codigo: String(item?.Codigo || '0'),
      mensagem: String(item?.Mensagem || 'Erro desconhecido'),
      correcao: item?.Correcao ? String(item.Correcao) : undefined,
    });
  }

  return mensagens;
}

function parseRetornoEnvio(retorno: any): NfseResponse {
  // Verificar se há mensagens de erro
  const mensagens = extrairMensagens(retorno);
  if (mensagens.length > 0) {
    return {
      success: false,
      status: 'rejeitado',
      protocolo: retorno?.Protocolo ? String(retorno.Protocolo) : undefined,
      mensagens,
    };
  }

  // Verificar se retornou protocolo (processamento assíncrono)
  const protocolo = retorno?.Protocolo || retorno?.NumeroLote;
  if (protocolo) {
    return {
      success: true,
      status: 'processando',
      protocolo: String(protocolo),
    };
  }

  // Sem erro e sem protocolo — resposta inesperada
  return {
    success: false,
    status: 'erro',
    mensagens: [{ codigo: '0', mensagem: 'Resposta inesperada do servidor' }],
  };
}

function parseRetornoConsultaLote(retorno: any): NfseResponse {
  // Verificar erros
  const mensagens = extrairMensagens(retorno);
  if (mensagens.length > 0 && !retorno?.ListaNfse) {
    return {
      success: false,
      status: 'rejeitado',
      mensagens,
    };
  }

  // Extrair NFS-e do retorno
  const listaNfse = retorno?.ListaNfse?.CompNfse;
  if (listaNfse) {
    const nfse = Array.isArray(listaNfse) ? listaNfse[0] : listaNfse;
    const infNfse = nfse?.Nfse?.InfNfse;

    return {
      success: true,
      status: 'autorizado',
      numeroNfse: infNfse?.Numero ? Number(infNfse.Numero) : undefined,
      codigoVerificacao: infNfse?.CodigoVerificacao ? String(infNfse.CodigoVerificacao) : undefined,
      dataEmissao: infNfse?.DataEmissao ? String(infNfse.DataEmissao) : undefined,
    };
  }

  return {
    success: false,
    status: 'processando',
    mensagens: [{ codigo: '0', mensagem: 'Lote ainda em processamento' }],
  };
}

function parseRetornoCancelamento(retorno: any): NfseResponse {
  const mensagens = extrairMensagens(retorno);

  // Verificar se cancelamento foi confirmado
  const confirmacao = retorno?.RetCancelamento?.NfseCancelamento?.Confirmacao;
  if (confirmacao) {
    return {
      success: true,
      status: 'cancelado',
      dataEmissao: confirmacao?.DataHora ? String(confirmacao.DataHora) : undefined,
      mensagens: mensagens.length > 0 ? mensagens : undefined,
    };
  }

  if (mensagens.length > 0) {
    return {
      success: false,
      status: 'rejeitado',
      mensagens,
    };
  }

  return {
    success: false,
    status: 'erro',
    mensagens: [{ codigo: '0', mensagem: 'Resposta inesperada do servidor ao cancelar' }],
  };
}
