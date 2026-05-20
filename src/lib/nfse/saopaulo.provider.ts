// ============================================================
// SaoPauloProvider — NFS-e via Nota Fiscal Paulistana
//
// Protocolo: SOAP 1.1 (lotenfe.asmx)
// Endpoint prod:  https://nfews.prefeitura.sp.gov.br/lotenfe.asmx
// Endpoint homol: https://nfehmg.prefeitura.sp.gov.br/lotenfe.asmx
// Namespace: http://www.prefeitura.sp.gov.br/nfe
//
// Particularidades:
//   - Código de serviço é municipal (4-5 dígitos), NÃO LC 116
//   - Alíquota é decimal (0.05 = 5%)
//   - RPS exige hash assinado RSA-SHA1 (campo <Assinatura>)
//   - XML inteiro assinado com xmldsig enveloped (RSA-SHA1)
//   - mTLS obrigatório (certificado ICP-Brasil)
//   - Discriminação usa | como quebra de linha
//
// Esteira: Hash RPS → XML PedidoEnvioRPS → Assinar XML → SOAP POST
// ============================================================

import * as crypto from 'crypto';
import { SignedXml } from 'xml-crypto';
import type { INfseProvider } from './provider.interface';
import type { CertificateData } from '../../types';
import type {
  NfseEmitirRequest,
  NfseCancelarRequest,
  NfseConsultarNfseRequest,
  NfseResponse,
  NfseMensagemRetorno,
} from '../../types/nfse';
import { enviarSoap, extrairBodySoap } from '../sefaz/soap-client';
import { parsePfx, apenasNumeros, escapeXml, formatarData } from '../utils';
import { config } from '../../config';
import { resolveCodigoServicoSP } from './service-codes-sp';

// ============================================================
// Constantes
// ============================================================

const SP_URL_PRODUCAO    = 'https://nfews.prefeitura.sp.gov.br/lotenfe.asmx';
const SP_URL_HOMOLOGACAO = 'https://nfehmg.prefeitura.sp.gov.br/lotenfe.asmx';
const SP_NS              = 'http://www.prefeitura.sp.gov.br/nfe';
const SP_SOAP_ACTION_BASE = 'http://www.prefeitura.sp.gov.br/nfe/ws';

function getSpUrl(ambiente?: string): string {
  const amb = ambiente || config.sefazAmbiente || 'producao';
  return amb === 'homologacao' ? SP_URL_HOMOLOGACAO : SP_URL_PRODUCAO;
}

// ============================================================
// RPS Hash Signature — assinatura proprietária de SP
// ============================================================

/**
 * Monta a string de hash fixa (v1 — 86+ posições) para assinatura do RPS.
 *
 * Posições:
 *  1  InscricaoPrestador   8 dígitos (zero-pad esquerda)
 *  2  SerieRPS             5 chars   (pad espaço direita)
 *  3  NumeroRPS           12 dígitos (zero-pad esquerda)
 *  4  DataEmissao          8 chars   AAAAMMDD
 *  5  TributacaoRPS        1 char
 *  6  StatusRPS            1 char    N | C
 *  7  ISSRetido            1 char    S | N
 *  8  ValorServicos       15 dígitos centavos (zero-pad)
 *  9  ValorDeducoes       15 dígitos centavos (zero-pad)
 * 10  CodigoServico        5 dígitos (zero-pad)
 * 11  IndicadorTomador     1 dígito  1=CPF 2=CNPJ 3=nenhum
 * 12  CPF/CNPJ Tomador    14 dígitos (zero-pad)
 */
function buildRpsHashString(params: {
  inscricaoPrestador: string;
  serie: string;
  numero: number;
  dataEmissao: string;   // YYYY-MM-DD
  tributacao: string;     // T, F, A, B, etc.
  status: string;         // N ou C
  issRetido: boolean;
  valorServicos: number;
  valorDeducoes: number;
  codigoServico: string;
  tomadorCpf?: string;
  tomadorCnpj?: string;
}): string {
  const im       = params.inscricaoPrestador.padStart(8, '0').slice(0, 8);
  const serie    = params.serie.padEnd(5, ' ').slice(0, 5);
  const numero   = String(params.numero).padStart(12, '0');
  const data     = params.dataEmissao.replace(/-/g, '');        // YYYYMMDD
  const trib     = params.tributacao.slice(0, 1);
  const status   = params.status.slice(0, 1);
  const retido   = params.issRetido ? 'S' : 'N';
  const valServ  = String(Math.round(params.valorServicos * 100)).padStart(15, '0');
  const valDed   = String(Math.round(params.valorDeducoes * 100)).padStart(15, '0');
  const codServ  = params.codigoServico.padStart(5, '0').slice(0, 5);

  let indTomador: string;
  let docTomador: string;
  if (params.tomadorCnpj) {
    indTomador = '2';
    docTomador = apenasNumeros(params.tomadorCnpj).padStart(14, '0');
  } else if (params.tomadorCpf) {
    indTomador = '1';
    docTomador = apenasNumeros(params.tomadorCpf).padStart(14, '0');
  } else {
    indTomador = '3';
    docTomador = '00000000000000';
  }

  return im + serie + numero + data + trib + status + retido
       + valServ + valDed + codServ + indTomador + docTomador;
}

/**
 * Assina a hash string do RPS com RSA-SHA1 (retorna Base64).
 */
function signRpsHash(hashString: string, certificado: CertificateData): string {
  const { privateKey } = parsePfx(certificado.pfxBase64, certificado.password);
  const signer = crypto.createSign('SHA1');
  signer.update(hashString, 'ascii');
  return signer.sign(privateKey, 'base64');
}

// ============================================================
// Helpers de tributação
// ============================================================

/**
 * Resolve código de tributação SP a partir dos campos do request.
 */
function resolveTributacao(request: NfseEmitirRequest): string {
  const codMun = request.servico.codigoMunicipioPrestacao || '';
  const isInSP = codMun === '3550308';

  switch (request.valores.exigibilidadeIss) {
    case '1': return isInSP ? 'T' : 'F';   // Exigível
    case '2': return isInSP ? 'T' : 'F';   // Não incidência
    case '3': return isInSP ? 'A' : 'B';   // Isenção
    case '4': return 'P';                    // Exportação
    case '5': return isInSP ? 'M' : 'N';   // Imunidade
    case '6': return isInSP ? 'X' : 'V';   // Suspensa judicial
    case '7': return isInSP ? 'X' : 'V';   // Suspensa administrativa
    default:  return 'T';
  }
}

function mapTipoRPS(tipo: string): string {
  switch (tipo) {
    case '1': return 'RPS';
    case '2': return 'RPS-M';
    case '3': return 'RPS-C';
    default:  return 'RPS';
  }
}

// ============================================================
// Builders de XML
// ============================================================

/**
 * Constrói XML PedidoEnvioRPS (versão 1) com hash RPS assinada.
 * Retorna XML sem assinatura digital — assinar depois com assinarXmlSP().
 */
function buildPedidoEnvioRPS(request: NfseEmitirRequest): string {
  const cnpj         = apenasNumeros(request.prestador.cnpj);
  const im           = apenasNumeros(request.prestador.inscricaoMunicipal).padStart(8, '0');
  const tipoRPS      = mapTipoRPS(request.rps.tipo);
  const statusRPS    = 'N';
  const tributacao   = resolveTributacao(request);
  const dataEmissao  = request.rps.dataEmissao || formatarData();

  // Código de serviço municipal (SP usa 4-5 dígitos próprios, NÃO LC 116).
  // Preferência: codigoTributacaoMunicipio informado pelo usuário.
  // Fallback: de-para automático LC 116 → código SP via service-codes-sp.ts.
  const codigoServicoRaw = request.servico.codigoTributacaoMunicipio
    || resolveCodigoServicoSP(request.servico.codigoServico || '')
    || request.servico.codigoServico
    || '';

  if (!request.servico.codigoTributacaoMunicipio && request.servico.codigoServico) {
    const traduzido = resolveCodigoServicoSP(request.servico.codigoServico);
    if (traduzido) {
      console.log(`[SP] Código de serviço LC 116 "${request.servico.codigoServico}" → código municipal SP "${traduzido}" (automático)`);
    } else {
      console.warn(`[SP] Código de serviço LC 116 "${request.servico.codigoServico}" sem mapeamento para SP — enviando como código municipal direto. Informe codigoTributacaoMunicipio para evitar rejeição.`);
    }
  }

  const codigoServico = codigoServicoRaw.replace(/\D/g, '').padStart(5, '0');

  // Alíquota já normalizada como decimal (0.05 = 5%)
  const aliquota = request.valores.aliquotaIss;

  // --- Hash do RPS ---
  const hashStr = buildRpsHashString({
    inscricaoPrestador: im,
    serie:        request.rps.serie,
    numero:       request.rps.numero,
    dataEmissao,
    tributacao,
    status:       statusRPS,
    issRetido:    request.valores.issRetido,
    valorServicos: request.valores.valorServicos,
    valorDeducoes: request.valores.valorDeducoes || 0,
    codigoServico,
    tomadorCpf:   request.tomador.cpf ? apenasNumeros(request.tomador.cpf) : undefined,
    tomadorCnpj:  request.tomador.cnpj ? apenasNumeros(request.tomador.cnpj) : undefined,
  });
  const assinatura = signRpsHash(hashStr, request.certificado);

  // --- Tomador ---
  let tomadorXml = '';
  if (request.tomador.cpf) {
    tomadorXml += `<CPFCNPJTomador><CPF>${apenasNumeros(request.tomador.cpf).padStart(11, '0')}</CPF></CPFCNPJTomador>`;
  } else if (request.tomador.cnpj) {
    tomadorXml += `<CPFCNPJTomador><CNPJ>${apenasNumeros(request.tomador.cnpj).padStart(14, '0')}</CNPJ></CPFCNPJTomador>`;
  }
  if (request.tomador.inscricaoMunicipal) {
    tomadorXml += `<InscricaoMunicipalTomador>${apenasNumeros(request.tomador.inscricaoMunicipal).padStart(8, '0')}</InscricaoMunicipalTomador>`;
  }
  if (request.tomador.nome) {
    tomadorXml += `<RazaoSocialTomador>${escapeXml(request.tomador.nome.slice(0, 75))}</RazaoSocialTomador>`;
  }
  if (request.tomador.endereco) {
    const a = request.tomador.endereco;
    tomadorXml += '<EnderecoTomador>';
    tomadorXml += `<Logradouro>${escapeXml(a.logradouro.slice(0, 125))}</Logradouro>`;
    tomadorXml += `<NumeroEndereco>${escapeXml(a.numero.slice(0, 10))}</NumeroEndereco>`;
    if (a.complemento) tomadorXml += `<ComplementoEndereco>${escapeXml(a.complemento.slice(0, 30))}</ComplementoEndereco>`;
    tomadorXml += `<Bairro>${escapeXml(a.bairro.slice(0, 30))}</Bairro>`;
    tomadorXml += `<Cidade>${a.codigoMunicipio}</Cidade>`;
    tomadorXml += `<UF>${a.uf}</UF>`;
    tomadorXml += `<CEP>${apenasNumeros(a.cep).padStart(8, '0')}</CEP>`;
    tomadorXml += '</EnderecoTomador>';
  }
  if (request.tomador.contato?.email) {
    tomadorXml += `<EmailTomador>${escapeXml(request.tomador.contato.email.slice(0, 75))}</EmailTomador>`;
  }

  // Discriminação (| = quebra de linha no SP)
  const discriminacao = escapeXml(
    (request.servico.discriminacao || '').replace(/\n/g, '|'),
  );

  // --- XML ---
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<nfe:PedidoEnvioRPS xmlns:nfe="${SP_NS}">`,
    `<Cabecalho Versao="1">`,
    `<CPFCNPJRemetente><CNPJ>${cnpj}</CNPJ></CPFCNPJRemetente>`,
    `</Cabecalho>`,
    `<RPS>`,
    `<Assinatura>${assinatura}</Assinatura>`,
    `<ChaveRPS>`,
    `<InscricaoPrestador>${im}</InscricaoPrestador>`,
    `<SerieRPS>${escapeXml(request.rps.serie)}</SerieRPS>`,
    `<NumeroRPS>${request.rps.numero}</NumeroRPS>`,
    `</ChaveRPS>`,
    `<TipoRPS>${tipoRPS}</TipoRPS>`,
    `<DataEmissao>${dataEmissao}</DataEmissao>`,
    `<StatusRPS>${statusRPS}</StatusRPS>`,
    `<TributacaoRPS>${tributacao}</TributacaoRPS>`,
    `<ValorServicos>${request.valores.valorServicos.toFixed(2)}</ValorServicos>`,
    `<ValorDeducoes>${(request.valores.valorDeducoes || 0).toFixed(2)}</ValorDeducoes>`,
    `<ValorPIS>${(request.valores.valorPis || 0).toFixed(2)}</ValorPIS>`,
    `<ValorCOFINS>${(request.valores.valorCofins || 0).toFixed(2)}</ValorCOFINS>`,
    `<ValorINSS>${(request.valores.valorInss || 0).toFixed(2)}</ValorINSS>`,
    `<ValorIR>${(request.valores.valorIr || 0).toFixed(2)}</ValorIR>`,
    `<ValorCSLL>${(request.valores.valorCsll || 0).toFixed(2)}</ValorCSLL>`,
    `<CodigoServico>${codigoServico}</CodigoServico>`,
    `<AliquotaServicos>${aliquota.toFixed(4)}</AliquotaServicos>`,
    `<ISSRetido>${request.valores.issRetido}</ISSRetido>`,
    tomadorXml,
    `<Discriminacao>${discriminacao}</Discriminacao>`,
    `</RPS>`,
    `</nfe:PedidoEnvioRPS>`,
  ].join('');
}

/**
 * Constrói XML PedidoCancelamentoNFe (versão 1).
 * Retorna XML sem assinatura digital.
 */
function buildPedidoCancelamentoNFe(
  cnpj: string,
  inscricaoPrestador: string,
  numeroNfse: number,
  certificado: CertificateData,
): string {
  const im = inscricaoPrestador.padStart(8, '0');

  // Hash de cancelamento: IM(8) + NumeroNFe(12) = 20 posições
  const cancelHashStr = im + String(numeroNfse).padStart(12, '0');
  const assinaturaCancelamento = signRpsHash(cancelHashStr, certificado);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<nfe:PedidoCancelamentoNFe xmlns:nfe="${SP_NS}">`,
    `<Cabecalho Versao="1">`,
    `<CPFCNPJRemetente><CNPJ>${cnpj}</CNPJ></CPFCNPJRemetente>`,
    `<transacao>true</transacao>`,
    `</Cabecalho>`,
    `<Detalhe>`,
    `<ChaveNFe>`,
    `<InscricaoPrestador>${im}</InscricaoPrestador>`,
    `<NumeroNFe>${numeroNfse}</NumeroNFe>`,
    `</ChaveNFe>`,
    `<AssinaturaCancelamento>${assinaturaCancelamento}</AssinaturaCancelamento>`,
    `</Detalhe>`,
    `</nfe:PedidoCancelamentoNFe>`,
  ].join('');
}

/**
 * Constrói XML ConsultaNFe por chave RPS.
 */
function buildConsultaNFeXml(
  cnpj: string,
  inscricaoPrestador: string,
  numero?: number,
  serieRPS?: string,
  numeroRPS?: number,
): string {
  const im = inscricaoPrestador.padStart(8, '0');

  // Consulta por chave da NFS-e (número + código verificação) ou por chave RPS
  if (numero) {
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<nfe:PedidoConsultaNFe xmlns:nfe="${SP_NS}">`,
      `<Cabecalho Versao="1">`,
      `<CPFCNPJRemetente><CNPJ>${cnpj}</CNPJ></CPFCNPJRemetente>`,
      `</Cabecalho>`,
      `<Detalhe>`,
      `<ChaveNFe>`,
      `<InscricaoPrestador>${im}</InscricaoPrestador>`,
      `<NumeroNFe>${numero}</NumeroNFe>`,
      `</ChaveNFe>`,
      `</Detalhe>`,
      `</nfe:PedidoConsultaNFe>`,
    ].join('');
  }

  // Consulta por chave RPS
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<nfe:PedidoConsultaNFe xmlns:nfe="${SP_NS}">`,
    `<Cabecalho Versao="1">`,
    `<CPFCNPJRemetente><CNPJ>${cnpj}</CNPJ></CPFCNPJRemetente>`,
    `</Cabecalho>`,
    `<Detalhe>`,
    `<ChaveRPS>`,
    `<InscricaoPrestador>${im}</InscricaoPrestador>`,
    `<SerieRPS>${escapeXml(serieRPS || 'NF')}</SerieRPS>`,
    `<NumeroRPS>${numeroRPS || 0}</NumeroRPS>`,
    `</ChaveRPS>`,
    `</Detalhe>`,
    `</nfe:PedidoConsultaNFe>`,
  ].join('');
}

// ============================================================
// Assinatura XML Digital (W3C xmldsig) — enveloped, RSA-SHA1
// ============================================================

/**
 * Assina XML para envio à Prefeitura de SP.
 * URI="" (documento inteiro) com enveloped-signature + C14N.
 */
function assinarXmlSP(xml: string, certificado: CertificateData): string {
  const { privateKey, certificate } = parsePfx(certificado.pfxBase64, certificado.password);

  const certPem = certificate
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const sig = new SignedXml({
    privateKey,
    publicCert: certificate,
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certPem}</X509Certificate></X509Data>`,
  });

  sig.addReference({
    xpath: '/*',
    isEmptyUri: true,
    digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
  });

  sig.computeSignature(xml, {
    location: { reference: '/*', action: 'append' },
  });

  return sig.getSignedXml();
}

// ============================================================
// Transporte SOAP — usa enviarSoap do soap-client (mTLS)
// ============================================================

/**
 * Envia XML para o webservice SP dentro de um envelope SOAP.
 *
 * O lotenfe.asmx espera:
 * <OperacaoRequest xmlns="...nfe">
 *   <VersaoSchema>1</VersaoSchema>
 *   <MensagemXML><![CDATA[...]]></MensagemXML>
 * </OperacaoRequest>
 */
async function enviarParaSP(
  operacao: string,
  xmlAssinado: string,
  certificado: CertificateData,
  ambiente?: string,
): Promise<string> {
  const url = getSpUrl(ambiente);
  const soapBody = [
    `<${operacao}Request xmlns="${SP_NS}">`,
    `<VersaoSchema>1</VersaoSchema>`,
    `<MensagemXML><![CDATA[${xmlAssinado}]]></MensagemXML>`,
    `</${operacao}Request>`,
  ].join('');

  const actionName = operacao.charAt(0).toLowerCase() + operacao.slice(1);
  const soapAction = `${SP_SOAP_ACTION_BASE}/${actionName}`;
  return enviarSoap(url, soapAction, soapBody, certificado, '1.2');
}

// ============================================================
// Parsers de resposta
// ============================================================

function extrairMensagensSP(body: any): NfseMensagemRetorno[] {
  // Erros
  const erros = body?.Erro || body?.RetornoEnvioRPS?.Erro || body?.RetornoCancelamentoNFe?.Erro;
  if (erros) {
    const items = Array.isArray(erros) ? erros : [erros];
    return items.map((e: any) => ({
      codigo: String(e?.Codigo || '0'),
      mensagem: String(e?.Descricao || 'Erro desconhecido'),
    }));
  }

  // Alertas
  const alertas = body?.Alerta || body?.RetornoEnvioRPS?.Alerta;
  if (alertas) {
    const items = Array.isArray(alertas) ? alertas : [alertas];
    return items.map((a: any) => ({
      codigo: String(a?.Codigo || '0'),
      mensagem: String(a?.Descricao || 'Alerta'),
    }));
  }

  return [];
}

function parseRetornoEnvioRPS(soapXml: string): NfseResponse {
  const body    = extrairBodySoap(soapXml);
  const retorno = body?.EnvioRPSResponse?.RetornoXML
               || body?.RetornoEnvioRPS
               || body;

  // Parse RetornoXML string se for string
  let parsed = retorno;
  if (typeof retorno === 'string') {
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, trimValues: true });
    parsed = parser.parse(retorno);
    if (parsed.RetornoEnvioRPS) parsed = parsed.RetornoEnvioRPS;
  }

  const sucesso  = parsed?.Cabecalho?.Sucesso === 'true' || parsed?.Cabecalho?.Sucesso === true;
  const mensagens = extrairMensagensSP(parsed);

  if (!sucesso) {
    return { success: false, status: 'rejeitado', mensagens };
  }

  // Extrair chave da NFS-e
  const chave = parsed?.ChaveNFeRPS?.ChaveNFe || parsed?.ChaveNFeRPS;
  const numeroNfse        = chave?.NumeroNFe ? Number(chave.NumeroNFe) : undefined;
  const codigoVerificacao = chave?.CodigoVerificacao ? String(chave.CodigoVerificacao) : undefined;

  return {
    success: true,
    status: 'autorizado',
    numeroNfse,
    codigoVerificacao,
    dataEmissao: new Date().toISOString(),
    mensagens: mensagens.length > 0 ? mensagens : undefined,
  };
}

function parseRetornoCancelamento(soapXml: string): NfseResponse {
  const body    = extrairBodySoap(soapXml);
  const retorno = body?.CancelamentoNFeResponse?.RetornoXML
               || body?.RetornoCancelamentoNFe
               || body;

  let parsed = retorno;
  if (typeof retorno === 'string') {
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, trimValues: true });
    parsed = parser.parse(retorno);
    if (parsed.RetornoCancelamentoNFe) parsed = parsed.RetornoCancelamentoNFe;
  }

  const sucesso   = parsed?.Cabecalho?.Sucesso === 'true' || parsed?.Cabecalho?.Sucesso === true;
  const mensagens = extrairMensagensSP(parsed);

  if (!sucesso) {
    return { success: false, status: 'rejeitado', mensagens };
  }

  return {
    success: true,
    status: 'cancelado',
    mensagens: mensagens.length > 0 ? mensagens : undefined,
  };
}

function parseRetornoConsulta(soapXml: string): NfseResponse {
  const body    = extrairBodySoap(soapXml);
  const retorno = body?.ConsultaNFeResponse?.RetornoXML
               || body?.RetornoConsulta
               || body;

  let parsed = retorno;
  if (typeof retorno === 'string') {
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, trimValues: true });
    parsed = parser.parse(retorno);
    if (parsed.RetornoConsulta) parsed = parsed.RetornoConsulta;
  }

  const sucesso   = parsed?.Cabecalho?.Sucesso === 'true' || parsed?.Cabecalho?.Sucesso === true;
  const mensagens = extrairMensagensSP(parsed);

  if (!sucesso) {
    return { success: false, status: 'erro', mensagens };
  }

  // Extrair dados da NFe
  const nfe           = parsed?.NFe;
  const chave         = nfe?.ChaveNFe;
  const numeroNfse    = chave?.NumeroNFe ? Number(chave.NumeroNFe) : undefined;
  const codVerif      = chave?.CodigoVerificacao ? String(chave.CodigoVerificacao) : undefined;
  const dataEmissao   = nfe?.DataEmissaoNFe ? String(nfe.DataEmissaoNFe) : undefined;

  return {
    success: true,
    status: 'autorizado',
    numeroNfse,
    codigoVerificacao: codVerif,
    dataEmissao,
    mensagens: mensagens.length > 0 ? mensagens : undefined,
  };
}

// ============================================================
// Provider
// ============================================================

export class SaoPauloProvider implements INfseProvider {
  readonly nome = 'São Paulo (Nota Fiscal Paulistana)';

  async emitir(request: NfseEmitirRequest): Promise<NfseResponse> {
    try {
      // 1. Construir XML do PedidoEnvioRPS (inclui hash do RPS assinado)
      const xml = buildPedidoEnvioRPS(request);

      // 2. Assinar XML inteiro com xmldsig enveloped
      const xmlAssinado = assinarXmlSP(xml, request.certificado);

      // 3. Enviar via SOAP para lotenfe.asmx
      const soapResp = await enviarParaSP('EnvioRPS', xmlAssinado, request.certificado, request.ambiente);

      // 4. Parsear resposta
      const result = parseRetornoEnvioRPS(soapResp);
      console.log(`[SP] Resultado emissão: success=${result.success} status=${result.status}${result.numeroNfse ? ` nfse=${result.numeroNfse}` : ''}${result.mensagens?.length ? ` mensagens=${JSON.stringify(result.mensagens)}` : ''}`);
      if (result.success && result.numeroNfse && result.codigoVerificacao) {
        const im = apenasNumeros(request.prestador.inscricaoMunicipal);
        result.linkVisualizacao = `https://nfe.prefeitura.sp.gov.br/contribuinte/notaprint.aspx?inscricao=${im}&nf=${result.numeroNfse}&verificacao=${result.codigoVerificacao}`;
      }
      return result;
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na emissão via SP' }],
      };
    }
  }

  async cancelar(request: NfseCancelarRequest): Promise<NfseResponse> {
    try {
      const cnpj = apenasNumeros(request.prestador.cnpj);
      const im   = apenasNumeros(request.prestador.inscricaoMunicipal);

      // 1. Construir XML de cancelamento
      const xml = buildPedidoCancelamentoNFe(cnpj, im, request.numero, request.certificado);

      // 2. Assinar
      const xmlAssinado = assinarXmlSP(xml, request.certificado);

      // 3. Enviar
      const soapResp = await enviarParaSP('CancelamentoNFe', xmlAssinado, request.certificado, request.ambiente);

      // 4. Parsear
      return parseRetornoCancelamento(soapResp);
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro no cancelamento via SP' }],
      };
    }
  }

  async consultar(request: NfseConsultarNfseRequest): Promise<NfseResponse> {
    try {
      const cnpj = apenasNumeros(request.prestador.cnpj);
      const im   = apenasNumeros(request.prestador.inscricaoMunicipal);

      // Construir XML de consulta
      const xml = buildConsultaNFeXml(cnpj, im, request.numero);

      // Assinar
      const xmlAssinado = assinarXmlSP(xml, request.certificado);

      // Enviar
      const soapResp = await enviarParaSP('ConsultaNFe', xmlAssinado, request.certificado, request.ambiente);

      // Parsear
      return parseRetornoConsulta(soapResp);
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na consulta via SP' }],
      };
    }
  }
}
