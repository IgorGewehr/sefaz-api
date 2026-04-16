// ============================================================
// BethaLegacyProvider — NFS-e via Betha Cloud (RPS/ABRASF 2.02)
//
// Protocolo: SOAP 1.1 document/literal com CDATA
// Fluxo:     recepcionarLoteRps → poll consultarSituacaoLoteRps → consultarLoteRps
//
// Diferente do BethaProvider (DPS/Padrão Nacional), este usa o
// formato legado ABRASF com envio de lote assíncrono.
// ============================================================

import * as http from 'http';
import type { INfseProvider } from './provider.interface';
import type { CertificateData } from '../../types';
import type {
  NfseEmitirRequest,
  NfseCancelarRequest,
  NfseConsultarNfseRequest,
  NfseResponse,
  NfseMensagemRetorno,
} from '../../types/nfse';
import { assinarXml } from '../sefaz/xml-signer';
import { extrairBodySoap } from '../sefaz/soap-client';
import { apenasNumeros, formatarValor } from '../utils';
import { logSoapRequest, logSoapResponse, logSoapError } from '../logger/soap-logger';

// ============================================================
// Constantes
// ============================================================

const BETHA_NS = 'http://www.betha.com.br/e-nota-contribuinte-ws';

// Sistema antigo Betha (portal e-gov.betha.com.br)
// Endpoint único — operação determinada pelo elemento SOAP no body
// Protocolo: HTTP puro (porta 80) — autenticação via assinatura XML
const BETHA_LEGACY_HOST     = 'e-gov.betha.com.br';
const BETHA_LEGACY_PATH_PROD = '/e-nota-contribuinte-ws/nfseWS';
const BETHA_LEGACY_PATH_HOM  = '/e-nota-contribuinte-test-ws/nfseWS';

function getLegacyPath(ambiente?: string): string {
  return ambiente === 'homologacao' ? BETHA_LEGACY_PATH_HOM : BETHA_LEGACY_PATH_PROD;
}

const CABECALHO = `<cabecalho xmlns="${BETHA_NS}" versao="2.02"><versaoDados>2.02</versaoDados></cabecalho>`;

// Polling: up to 10 attempts × 3s = 30s max wait
const POLL_MAX = 10;
const POLL_INTERVAL_MS = 3000;

// Situacao: 1=Não recebido, 2=Não processado, 3=Processado c/ erro, 4=Processado c/ sucesso
const SITUACAO_SUCESSO = '4';
const SITUACAO_ERRO    = '3';

// ============================================================
// SOAP Envelope Builder (CDATA)
// ============================================================

function buildSoapEnvelope(operacao: string, xmlPayload: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:e="${BETHA_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <e:${operacao}>
      <nfseCabecMsg><![CDATA[${CABECALHO}]]></nfseCabecMsg>
      <nfseDadosMsg><![CDATA[${xmlPayload}]]></nfseDadosMsg>
    </e:${operacao}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ============================================================
// XML Builders — ABRASF 2.02
// ============================================================

/** Core RPS payload (InfDeclaracaoPrestacaoServico) — used inside EnviarLoteRpsEnvio */
function buildInfDeclaracaoXml(request: NfseEmitirRequest): string {
  const cnpj = apenasNumeros(request.prestador.cnpj);
  const im = request.prestador.inscricaoMunicipal || '';
  const v = request.valores;
  const isSimples = request.prestador.optanteSimplesNacional;

  const itemLista = (request.servico.codigoServico || request.servico.codigoTributacaoNacional || '')
    .replace(/\D/g, '').slice(0, 5);

  const aliquota = formatarValor(v.aliquotaIss, 4);
  const baseCalculo = v.valorServicos - (v.valorDeducoes || 0) - (v.descontoIncondicionado || 0);
  const valorIss = formatarValor(baseCalculo * v.aliquotaIss, 2);

  let tomadorXml = '';
  if (request.tomador.nome) {
    let idTomador = '';
    if (request.tomador.cnpj) {
      idTomador = `<IdentificacaoTomador><CpfCnpj><Cnpj>${apenasNumeros(request.tomador.cnpj)}</Cnpj></CpfCnpj></IdentificacaoTomador>`;
    } else if (request.tomador.cpf) {
      idTomador = `<IdentificacaoTomador><CpfCnpj><Cpf>${apenasNumeros(request.tomador.cpf)}</Cpf></CpfCnpj></IdentificacaoTomador>`;
    }
    let endTomador = '';
    if (request.tomador.endereco) {
      const e = request.tomador.endereco;
      endTomador = '<Endereco>' +
        `<Endereco>${e.logradouro || ''}</Endereco>` +
        `<Numero>${e.numero || 'SN'}</Numero>` +
        (e.complemento ? `<Complemento>${e.complemento}</Complemento>` : '') +
        `<Bairro>${e.bairro || ''}</Bairro>` +
        `<CodigoMunicipio>${e.codigoMunicipio}</CodigoMunicipio>` +
        `<Uf>${e.uf}</Uf>` +
        `<Cep>${apenasNumeros(e.cep)}</Cep>` +
        '</Endereco>';
    }
    let contatoTomador = '';
    if (request.tomador.contato?.email || request.tomador.contato?.telefone) {
      contatoTomador = '<Contato>' +
        (request.tomador.contato.telefone ? `<Telefone>${apenasNumeros(request.tomador.contato.telefone)}</Telefone>` : '') +
        (request.tomador.contato.email ? `<Email>${request.tomador.contato.email}</Email>` : '') +
        '</Contato>';
    }
    tomadorXml = `<Tomador>${idTomador}<RazaoSocial>${request.tomador.nome}</RazaoSocial>${endTomador}${contatoTomador}</Tomador>`;
  }

  const regimeEsp = request.prestador.regimeEspecialTributacao || (isSimples ? '6' : '');
  const regimeXml = regimeEsp ? `<RegimeEspecialTributacao>${regimeEsp}</RegimeEspecialTributacao>` : '';
  const exigibilidade = v.exigibilidadeIss || '1';
  const issRetido = v.issRetido ? '1' : '2';

  return `<InfDeclaracaoPrestacaoServico Id="rps${request.rps.numero}">` +
    '<Rps>' +
      '<IdentificacaoRps>' +
        `<Numero>${request.rps.numero}</Numero>` +
        `<Serie>${request.rps.serie}</Serie>` +
        `<Tipo>${request.rps.tipo || '1'}</Tipo>` +
      '</IdentificacaoRps>' +
      `<DataEmissao>${request.rps.dataEmissao}</DataEmissao>` +
      '<Status>1</Status>' +
    '</Rps>' +
    `<Competencia>${request.rps.dataEmissao}</Competencia>` +
    '<Servico>' +
      '<Valores>' +
        `<ValorServicos>${formatarValor(v.valorServicos)}</ValorServicos>` +
        (v.valorDeducoes      ? `<ValorDeducoes>${formatarValor(v.valorDeducoes)}</ValorDeducoes>` : '') +
        (v.valorPis           ? `<ValorPis>${formatarValor(v.valorPis)}</ValorPis>` : '') +
        (v.valorCofins        ? `<ValorCofins>${formatarValor(v.valorCofins)}</ValorCofins>` : '') +
        (v.valorInss          ? `<ValorInss>${formatarValor(v.valorInss)}</ValorInss>` : '') +
        (v.valorIr            ? `<ValorIr>${formatarValor(v.valorIr)}</ValorIr>` : '') +
        (v.valorCsll          ? `<ValorCsll>${formatarValor(v.valorCsll)}</ValorCsll>` : '') +
        (v.outrasRetencoes    ? `<OutrasRetencoes>${formatarValor(v.outrasRetencoes)}</OutrasRetencoes>` : '') +
        `<ValorIss>${valorIss}</ValorIss>` +
        `<Aliquota>${aliquota}</Aliquota>` +
        (v.descontoIncondicionado ? `<DescontoIncondicionado>${formatarValor(v.descontoIncondicionado)}</DescontoIncondicionado>` : '') +
        (v.descontoCondicionado   ? `<DescontoCondicionado>${formatarValor(v.descontoCondicionado)}</DescontoCondicionado>` : '') +
      '</Valores>' +
      `<IssRetido>${issRetido}</IssRetido>` +
      `<ItemListaServico>${itemLista}</ItemListaServico>` +
      (request.servico.cnae ? `<CodigoCnae>${request.servico.cnae}</CodigoCnae>` : '') +
      (request.servico.codigoTributacaoMunicipio ? `<CodigoTributacaoMunicipio>${request.servico.codigoTributacaoMunicipio}</CodigoTributacaoMunicipio>` : '') +
      `<Discriminacao>${request.servico.discriminacao}</Discriminacao>` +
      `<CodigoMunicipio>${request.servico.codigoMunicipioPrestacao}</CodigoMunicipio>` +
      `<ExigibilidadeISS>${exigibilidade}</ExigibilidadeISS>` +
      (request.servico.codigoMunicipioIncidencia ? `<MunicipioIncidencia>${request.servico.codigoMunicipioIncidencia}</MunicipioIncidencia>` : '') +
    '</Servico>' +
    '<Prestador>' +
      `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
      `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    '</Prestador>' +
    tomadorXml +
    regimeXml +
    `<OptanteSimplesNacional>${isSimples ? '1' : '2'}</OptanteSimplesNacional>` +
    `<IncentivoFiscal>${request.prestador.incentivadorCultural ? '1' : '2'}</IncentivoFiscal>` +
  '</InfDeclaracaoPrestacaoServico>';
}

/** Wrap signed RPS in a LoteRps batch envelope for RecepcionarLoteRps */
function buildEnviarLoteRpsXml(request: NfseEmitirRequest, signedInfXml: string): string {
  const cnpj = apenasNumeros(request.prestador.cnpj);
  const im = request.prestador.inscricaoMunicipal || '';

  return `<EnviarLoteRpsEnvio xmlns="${BETHA_NS}">` +
    `<LoteRps Id="lote${request.rps.numero}">` +
      `<NumeroLote>${request.rps.numero}</NumeroLote>` +
      `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
      `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
      '<QuantidadeRps>1</QuantidadeRps>' +
      '<ListaRps>' +
        `<Rps>${signedInfXml}</Rps>` +
      '</ListaRps>' +
    '</LoteRps>' +
  '</EnviarLoteRpsEnvio>';
}

function buildConsultarSituacaoXml(cnpj: string, im: string, protocolo: string): string {
  return `<ConsultarSituacaoLoteRpsEnvio xmlns="${BETHA_NS}">` +
    '<Prestador>' +
      `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
      `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    '</Prestador>' +
    `<Protocolo>${protocolo}</Protocolo>` +
  '</ConsultarSituacaoLoteRpsEnvio>';
}

function buildConsultarLoteXml(cnpj: string, im: string, protocolo: string): string {
  return `<ConsultarLoteRpsEnvio xmlns="${BETHA_NS}">` +
    '<Prestador>' +
      `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
      `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
    '</Prestador>' +
    `<Protocolo>${protocolo}</Protocolo>` +
  '</ConsultarLoteRpsEnvio>';
}

function buildCancelarNfseXml(
  numero: number,
  cnpj: string,
  im: string,
  codigoMunicipio: string,
  codigoCancelamento: string,
): string {
  return `<CancelarNfseEnvio xmlns="${BETHA_NS}">` +
    '<Pedido>' +
      `<InfPedidoCancelamento Id="cancel${numero}">` +
        '<IdentificacaoNfse>' +
          `<Numero>${numero}</Numero>` +
          `<CpfCnpj><Cnpj>${apenasNumeros(cnpj)}</Cnpj></CpfCnpj>` +
          `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
          `<CodigoMunicipio>${codigoMunicipio}</CodigoMunicipio>` +
        '</IdentificacaoNfse>' +
        `<CodigoCancelamento>${codigoCancelamento}</CodigoCancelamento>` +
      '</InfPedidoCancelamento>' +
    '</Pedido>' +
  '</CancelarNfseEnvio>';
}

// ============================================================
// Transporte SOAP HTTP (porta 80, sem TLS)
// e-gov.betha.com.br usa HTTP puro — autenticação via XML Signature
// ============================================================

async function enviarSoapBetha(
  operacao: string,
  envelope: string,
  _certificado: CertificateData,
  ambiente?: string,
): Promise<string> {
  const path = getLegacyPath(ambiente);
  const displayUrl = `http://${BETHA_LEGACY_HOST}${path}`;
  const startTime = Date.now();
  logSoapRequest(displayUrl, operacao, envelope);

  const payload = Buffer.from(envelope, 'utf-8');

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: BETHA_LEGACY_HOST,
        port: 80,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          'SOAPAction': `"${operacao}"`,
          'Content-Length': payload.length,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          const duration = Date.now() - startTime;
          logSoapResponse(displayUrl, operacao, res.statusCode || 0, data, duration);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            const err = new Error(`Betha Legacy retornou status ${res.statusCode}: ${data.slice(0, 500)}`);
            logSoapError(displayUrl, operacao, err, duration);
            reject(err);
          }
        });
      },
    );

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      const e = new Error(`Erro de conexão com Betha Legacy: ${err.message}`);
      logSoapError(displayUrl, operacao, e, duration);
      reject(e);
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout na conexão com Betha Legacy (60s)'));
    });

    req.write(payload);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// Parsers de resposta ABRASF
// ============================================================

function extrairMensagensAbrasf(body: any): NfseMensagemRetorno[] {
  const listas = [
    body?.ListaMensagemRetorno?.MensagemRetorno,
    body?.ListaMensagemRetornoLote?.MensagemRetorno,
    body?.MensagemRetorno,
  ];

  for (const lista of listas) {
    if (!lista) continue;
    const items = Array.isArray(lista) ? lista : [lista];
    return items.map((m: any) => ({
      codigo:    String(m?.Codigo   || m?.codigo   || '0'),
      mensagem:  String(m?.Mensagem || m?.mensagem || 'Erro'),
      correcao:  (m?.Correcao || m?.correcao) ? String(m.Correcao || m.correcao) : undefined,
    }));
  }

  return [];
}

/** Parse EnviarLoteRpsResposta → retorna protocolo ou lança erro */
function parseRecepcionarLoteResposta(soapXml: string): string {
  const body = extrairBodySoap(soapXml);
  const resposta = body?.EnviarLoteRpsResposta ?? body?.RecepcionarLoteRpsResposta ?? body;
  const mensagens = extrairMensagensAbrasf(resposta);

  const protocolo = resposta?.Protocolo ?? resposta?.protocolo;
  if (protocolo) return String(protocolo);

  const erroMsg = mensagens[0]?.mensagem || 'Protocolo não retornado pelo Betha Legacy';
  throw new Error(erroMsg);
}

/** Parse ConsultarSituacaoLoteRpsResposta → retorna situacao ('1'–'4') */
function parseSituacaoLoteResposta(soapXml: string): { situacao: string; mensagens: NfseMensagemRetorno[] } {
  const body = extrairBodySoap(soapXml);
  const resposta = body?.ConsultarSituacaoLoteRpsResposta ?? body;
  const mensagens = extrairMensagensAbrasf(resposta);
  const situacao = String(resposta?.Situacao ?? resposta?.situacao ?? '1');
  return { situacao, mensagens };
}

/** Parse ConsultarLoteRpsResposta → extrai NFS-e gerada */
function parseConsultarLoteResposta(soapXml: string): NfseResponse {
  const body = extrairBodySoap(soapXml);
  const resposta = body?.ConsultarLoteRpsResposta ?? body;
  const mensagens = extrairMensagensAbrasf(resposta);

  const compNfse = resposta?.ListaNfse?.CompNfse;
  const nfse = compNfse?.Nfse ?? (Array.isArray(compNfse) ? compNfse[0]?.Nfse : null);
  const infNfse = nfse?.InfNfse;

  if (infNfse) {
    return {
      success: true,
      status: 'autorizado',
      numeroNfse: infNfse.Numero ? Number(infNfse.Numero) : undefined,
      codigoVerificacao: infNfse.CodigoVerificacao ? String(infNfse.CodigoVerificacao) : undefined,
      dataEmissao: infNfse.DataEmissao ? String(infNfse.DataEmissao) : undefined,
      xml: soapXml,
      mensagens: mensagens.length > 0 ? mensagens : undefined,
    };
  }

  return {
    success: false,
    status: 'erro',
    mensagens: mensagens.length > 0 ? mensagens : [{ codigo: '0', mensagem: 'NFS-e não encontrada na resposta do lote' }],
  };
}

function parseCancelarNfseResposta(soapXml: string): NfseResponse {
  const body = extrairBodySoap(soapXml);
  const resposta = body?.CancelarNfseResposta ?? body;
  const mensagens = extrairMensagensAbrasf(resposta);

  const cancelamento = resposta?.RetCancelamento ?? resposta?.Cancelamento;
  if (cancelamento) {
    return { success: true, status: 'cancelado', mensagens: mensagens.length > 0 ? mensagens : undefined };
  }
  if (mensagens.length > 0) {
    return { success: false, status: 'rejeitado', mensagens };
  }
  return { success: true, status: 'cancelado' };
}

// ============================================================
// Provider
// ============================================================

export class BethaLegacyProvider implements INfseProvider {
  readonly nome = 'Betha Legacy (ABRASF 2.02)';

  async emitir(request: NfseEmitirRequest): Promise<NfseResponse> {
    try {
      const cnpj = apenasNumeros(request.prestador.cnpj);
      const im = request.prestador.inscricaoMunicipal || '';

      // 1. Build full lote XML (unsigned)
      const infXml = buildInfDeclaracaoXml(request);
      const loteXml = buildEnviarLoteRpsXml(request, infXml);

      // 2. Sign — places <Signature> after <InfDeclaracaoPrestacaoServico> inside <Rps>
      const signedLoteXml = assinarXml(loteXml, request.certificado, 'InfDeclaracaoPrestacaoServico');

      const amb = request.ambiente;

      // 3. Submit lote (async)
      const envioEnvelope = buildSoapEnvelope('RecepcionarLoteRps', signedLoteXml);
      const envioResp = await enviarSoapBetha('RecepcionarLoteRps', envioEnvelope, request.certificado, amb);
      const protocolo = parseRecepcionarLoteResposta(envioResp);

      // 4. Poll até processar (max 30s)
      let situacao = '2';
      let situacaoMensagens: NfseMensagemRetorno[] = [];
      for (let i = 0; i < POLL_MAX; i++) {
        await sleep(POLL_INTERVAL_MS);

        const consultaXml = buildConsultarSituacaoXml(cnpj, im, protocolo);
        const consultaEnvelope = buildSoapEnvelope('ConsultarSituacaoLoteRps', consultaXml);
        const consultaResp = await enviarSoapBetha('ConsultarSituacaoLoteRps', consultaEnvelope, request.certificado, amb);
        const { situacao: s, mensagens } = parseSituacaoLoteResposta(consultaResp);
        situacao = s;
        situacaoMensagens = mensagens;

        if (situacao === SITUACAO_SUCESSO || situacao === SITUACAO_ERRO) break;
      }

      if (situacao === SITUACAO_ERRO) {
        return {
          success: false,
          status: 'rejeitado',
          mensagens: situacaoMensagens.length > 0
            ? situacaoMensagens
            : [{ codigo: '0', mensagem: 'Lote processado com erro pelo Betha Legacy' }],
        };
      }

      if (situacao !== SITUACAO_SUCESSO) {
        return {
          success: false,
          status: 'erro',
          mensagens: [{ codigo: '0', mensagem: `Timeout aguardando processamento do lote (protocolo: ${protocolo})` }],
        };
      }

      // 5. Buscar NFS-e gerada
      const resultXml = buildConsultarLoteXml(cnpj, im, protocolo);
      const resultEnvelope = buildSoapEnvelope('ConsultarLoteRps', resultXml);
      const resultResp = await enviarSoapBetha('ConsultarLoteRps', resultEnvelope, request.certificado, amb);
      return parseConsultarLoteResposta(resultResp);
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na emissão via Betha Legacy' }],
      };
    }
  }

  async cancelar(request: NfseCancelarRequest): Promise<NfseResponse> {
    try {
      const cnpj = apenasNumeros(request.prestador.cnpj);
      const im = request.prestador.inscricaoMunicipal;
      const codigoCancelamento = String(request.codigoCancelamento);

      const xmlPayload = buildCancelarNfseXml(
        request.numero, cnpj, im, request.codigoMunicipio, codigoCancelamento,
      );

      const xmlAssinado = assinarXml(xmlPayload, request.certificado, 'InfPedidoCancelamento');
      const envelope = buildSoapEnvelope('CancelarNfse', xmlAssinado);

      const soapResp = await enviarSoapBetha('CancelarNfse', envelope, request.certificado, request.ambiente);
      return parseCancelarNfseResposta(soapResp);
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro no cancelamento via Betha Legacy' }],
      };
    }
  }

  async consultar(request: NfseConsultarNfseRequest): Promise<NfseResponse> {
    try {
      const cnpj = apenasNumeros(request.prestador.cnpj);
      const im = request.prestador.inscricaoMunicipal;

      if (!request.numero) {
        return {
          success: false,
          status: 'erro',
          mensagens: [{ codigo: '0', mensagem: 'Número do RPS é obrigatório para consulta via Betha Legacy' }],
        };
      }

      const xmlPayload = `<ConsultarNfseRpsEnvio xmlns="${BETHA_NS}">` +
        '<IdentificacaoRps>' +
          `<Numero>${request.numero}</Numero>` +
          '<Serie>NFS</Serie>' +
          '<Tipo>1</Tipo>' +
        '</IdentificacaoRps>' +
        '<Prestador>' +
          `<CpfCnpj><Cnpj>${cnpj}</Cnpj></CpfCnpj>` +
          `<InscricaoMunicipal>${im}</InscricaoMunicipal>` +
        '</Prestador>' +
      '</ConsultarNfseRpsEnvio>';

      const envelope = buildSoapEnvelope('ConsultarNfsePorRps', xmlPayload);
      const soapResp = await enviarSoapBetha('ConsultarNfsePorRps', envelope, request.certificado, request.ambiente);

      const body = extrairBodySoap(soapResp);
      const resposta = body?.ConsultarNfsePorRpsResposta ?? body;
      const mensagens = extrairMensagensAbrasf(resposta);

      const compNfse = resposta?.CompNfse;
      const infNfse = compNfse?.Nfse?.InfNfse;

      if (infNfse) {
        return {
          success: true,
          status: 'autorizado',
          numeroNfse: infNfse.Numero ? Number(infNfse.Numero) : undefined,
          codigoVerificacao: infNfse.CodigoVerificacao ? String(infNfse.CodigoVerificacao) : undefined,
          dataEmissao: infNfse.DataEmissao ? String(infNfse.DataEmissao) : undefined,
        };
      }

      return {
        success: false,
        status: 'erro',
        mensagens: mensagens.length > 0 ? mensagens : [{ codigo: '0', mensagem: 'NFS-e não encontrada' }],
      };
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na consulta via Betha Legacy' }],
      };
    }
  }
}
