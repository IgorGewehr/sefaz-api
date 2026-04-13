// ============================================================
// BethaProvider — NFS-e via Betha Cloud (DPS/SOAP)
//
// Protocolo: SOAP 1.1 document/literal
// Endpoint:  https://nota-eletronica.betha.cloud/dps/ws
// WSDL:      https://nota-eletronica.betha.cloud/dps/ws/service.wsdl
//
// Ambiente controlado por tpAmb no XML (não há URL separada):
//   tpAmb=1 → Produção
//   tpAmb=2 → Homologação
//
// Esteira: XML DPS → Assinar <infDPS> → SOAP POST inline (sem CDATA)
// ============================================================

import * as https from 'https';
import type { INfseProvider } from './provider.interface';
import type { CertificateData } from '../../types';
import type {
  NfseEmitirRequest,
  NfseCancelarRequest,
  NfseConsultarNfseRequest,
  NfseResponse,
  NfseMensagemRetorno,
} from '../../types/nfse';
import { buildDpsXml } from './nacional.provider';
import { assinarXml } from '../sefaz/xml-signer';
import { extrairBodySoap } from '../sefaz/soap-client';
import { pfxToBuffer, apenasNumeros, formatarDataSefaz } from '../utils';
import { config } from '../../config';
import { logSoapRequest, logSoapResponse, logSoapError } from '../logger/soap-logger';

// ============================================================
// Constantes
// ============================================================

const BETHA_CLOUD_URL = 'https://nota-eletronica.betha.cloud/dps/ws';
const BETHA_DPS_NS   = 'http://www.betha.com.br/e-nota-dps';

const MAX_POLLING  = 10;
const POLLING_MS   = 3000;

// ============================================================
// Builders de envelope SOAP
// ============================================================

/** RecepcionarDps — DPS XML assinado embutido inline (sem CDATA) */
export function buildRecepcionarDpsEnvelope(dpsXmlAssinado: string): string {
  // Remove declaração XML para embedding inline no SOAP body
  const dpsInline = dpsXmlAssinado.replace(/^<\?xml[^?]*\?>\s*/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:b="${BETHA_DPS_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <b:RecepcionarDpsEnvio>
      ${dpsInline}
    </b:RecepcionarDpsEnvio>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** ConsultarStatusDps — consulta situação por protocolo */
export function buildConsultarStatusEnvelope(
  protocolo: string,
  codigoIbge: string,
  cnpj: string,
  tpAmb: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:b="${BETHA_DPS_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <b:ConsultarStatusDpsEnvio>
      <b:tpAmb>${tpAmb}</b:tpAmb>
      <b:codigoIbge>${codigoIbge}</b:codigoIbge>
      <b:cpfCnpjPrestador>${cnpj}</b:cpfCnpjPrestador>
      <b:protocolo>${protocolo}</b:protocolo>
      <b:tipoIntegracao>EMISSAO</b:tipoIntegracao>
    </b:ConsultarStatusDpsEnvio>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/** RecepcionarEventoCancelamento — cancela NFS-e pela chave de acesso */
export function buildCancelarEnvelope(
  chNFSe: string,
  cnpj: string,
  cMotivo: string,
  xMotivo: string,
  tpAmb: string,
): string {
  const dhEvento = formatarDataSefaz();
  const ts = Date.now();
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:b="${BETHA_DPS_NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <b:RecepcionarEventoCancelamentoEnvio>
      <b:evento versao="1.00">
        <b:infEvento id="EVT${ts}">
          <b:pedRegEvento versao="1.00">
            <b:infPedReg id="PED${ts}">
              <b:chNFSe>${chNFSe}</b:chNFSe>
              <b:CNPJAutor>${cnpj}</b:CNPJAutor>
              <b:dhEvento>${dhEvento}</b:dhEvento>
              <b:tpAmb>${tpAmb}</b:tpAmb>
              <b:verAplic>sefaz-api-1.0</b:verAplic>
              <b:e101101>
                <b:xDesc>Cancelamento</b:xDesc>
                <b:cMotivo>${cMotivo}</b:cMotivo>
                <b:xMotivo>${xMotivo}</b:xMotivo>
              </b:e101101>
            </b:infPedReg>
          </b:pedRegEvento>
        </b:infEvento>
      </b:evento>
    </b:RecepcionarEventoCancelamentoEnvio>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ============================================================
// Transporte SOAP HTTPS
// ============================================================

async function enviarSoapBethaCloud(
  operacao: string,
  envelope: string,
  certificado: CertificateData,
): Promise<string> {
  const startTime = Date.now();
  logSoapRequest(BETHA_CLOUD_URL, operacao, envelope);

  const pfx = pfxToBuffer(certificado.pfxBase64);
  const agent = new https.Agent({
    pfx,
    passphrase: certificado.password,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
  });

  const urlObj  = new URL(BETHA_CLOUD_URL);
  const payload = Buffer.from(envelope, 'utf-8');

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': operacao,
        'Content-Length': payload.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        const duration = Date.now() - startTime;
        logSoapResponse(BETHA_CLOUD_URL, operacao, res.statusCode || 0, data, duration);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          const err = new Error(`Betha Cloud retornou status ${res.statusCode}: ${data.slice(0, 500)}`);
          logSoapError(BETHA_CLOUD_URL, operacao, err, duration);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      const e = new Error(`Erro de conexão com Betha Cloud: ${err.message}`);
      logSoapError(BETHA_CLOUD_URL, operacao, e, duration);
      reject(e);
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout na conexão com Betha Cloud (60s)'));
    });

    req.write(payload);
    req.end();
  });
}

// ============================================================
// Helpers
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// Parsers de resposta
// ============================================================

function extrairMensagens(resposta: any): NfseMensagemRetorno[] {
  const lista = resposta?.listaMensagens?.mensagem;
  if (!lista) return [];
  const items = Array.isArray(lista) ? lista : [lista];
  return items.map((m: any) => ({
    codigo: String(m?.codigo || '0'),
    mensagem: String(m?.mensagem || 'Erro'),
    correcao: m?.correcao ? String(m.correcao) : undefined,
  }));
}

function parseRecepcionarDpsResposta(soapXml: string): {
  protocolo?: string;
  status?: string;
  mensagens: NfseMensagemRetorno[];
} {
  const body     = extrairBodySoap(soapXml);
  const resposta = body?.RecepcionarDpsResposta ?? body;
  return {
    protocolo: resposta?.protocolo  ? String(resposta.protocolo)  : undefined,
    status:    resposta?.status     ? String(resposta.status)     : undefined,
    mensagens: extrairMensagens(resposta),
  };
}

function parseConsultarStatusResposta(soapXml: string): {
  status?: string;
  numeroNotaFiscal?: string;
  chaveAcesso?: string;
  linkPdf?: string;
  mensagens: NfseMensagemRetorno[];
} {
  const body     = extrairBodySoap(soapXml);
  const resposta = body?.ConsultarStatusDpsResposta ?? body;
  const emissao  = resposta?.emissao;
  return {
    status:           resposta?.statusProcessamento ? String(resposta.statusProcessamento) : undefined,
    numeroNotaFiscal: emissao?.numeroNotaFiscal     ? String(emissao.numeroNotaFiscal)     : undefined,
    chaveAcesso:      emissao?.chaveAcesso          ? String(emissao.chaveAcesso)          : undefined,
    linkPdf:          emissao?.linkPdf              ? String(emissao.linkPdf)              : undefined,
    mensagens:        extrairMensagens(resposta),
  };
}

// ============================================================
// Polling: aguarda processamento assíncrono da DPS
// ============================================================

async function aguardarProcessamento(
  protocolo: string,
  codigoIbge: string,
  cnpj: string,
  tpAmb: string,
  certificado: CertificateData,
): Promise<NfseResponse> {
  for (let i = 1; i <= MAX_POLLING; i++) {
    await sleep(POLLING_MS);
    try {
      const envelope = buildConsultarStatusEnvelope(protocolo, codigoIbge, cnpj, tpAmb);
      const soapResp = await enviarSoapBethaCloud('ConsultarStatusDps', envelope, certificado);
      const { status, numeroNotaFiscal, chaveAcesso, linkPdf, mensagens } =
        parseConsultarStatusResposta(soapResp);

      // Rejeição explícita
      if (status === 'ERRO' || status === 'REJEITADO') {
        return { success: false, status: 'rejeitado', protocolo, mensagens };
      }

      // NFS-e emitida com sucesso
      if (numeroNotaFiscal) {
        return {
          success: true,
          status: 'autorizado',
          protocolo,
          numeroNfse: Number(numeroNotaFiscal),
          codigoVerificacao: chaveAcesso,
          linkVisualizacao: linkPdf,
          mensagens: mensagens.length > 0 ? mensagens : undefined,
        };
      }

      // Ainda processando (RECEBIDO / PROCESSANDO / etc.)
    } catch { /* ignora erro pontual e tenta novamente */ }
  }

  return {
    success: false,
    status: 'processando',
    protocolo,
    mensagens: [{ codigo: '0', mensagem: `Betha Cloud ainda processando após ${MAX_POLLING} tentativas` }],
  };
}

// ============================================================
// Provider
// ============================================================

export class BethaProvider implements INfseProvider {
  readonly nome = 'Betha Cloud';

  async emitir(request: NfseEmitirRequest): Promise<NfseResponse> {
    try {
      const tpAmb      = (request.ambiente || config.sefazAmbiente) === 'producao' ? '1' : '2';
      const codigoIbge = request.servico.codigoMunicipioPrestacao;
      const cnpj       = apenasNumeros(request.prestador.cnpj);

      // 1. Construir XML DPS com namespace Betha Cloud
      const xmlDps = buildDpsXml(request, BETHA_DPS_NS);

      // 2. Assinar <infDPS> com SHA-256
      const xmlAssinado = assinarXml(xmlDps, request.certificado, 'infDPS');

      // 3. Montar envelope SOAP com DPS XML inline
      const envelope = buildRecepcionarDpsEnvelope(xmlAssinado);

      // 4. POST SOAP para Betha Cloud
      const soapResp = await enviarSoapBethaCloud('RecepcionarDps', envelope, request.certificado);
      const { protocolo, status, mensagens } = parseRecepcionarDpsResposta(soapResp);

      if (mensagens.length > 0 && !protocolo) {
        return { success: false, status: 'rejeitado', mensagens };
      }

      if (!protocolo) {
        return {
          success: false,
          status: 'erro',
          mensagens: [{ codigo: '0', mensagem: 'Betha Cloud não retornou protocolo de processamento' }],
        };
      }

      // Status imediato de erro
      if (status === 'ERRO' || status === 'REJEITADO') {
        return { success: false, status: 'rejeitado', protocolo, mensagens };
      }

      // 5. Aguardar processamento assíncrono via polling
      return await aguardarProcessamento(protocolo, codigoIbge, cnpj, tpAmb, request.certificado);
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na emissão via Betha Cloud' }],
      };
    }
  }

  async cancelar(request: NfseCancelarRequest): Promise<NfseResponse> {
    try {
      const tpAmb   = (request.ambiente || config.sefazAmbiente) === 'producao' ? '1' : '2';
      const cnpj    = apenasNumeros(request.prestador.cnpj);
      const chNFSe  = request.chaveNFSe || String(request.numero);
      const cMotivo = String(request.codigoCancelamento);
      const xMotivo = request.motivo || 'Cancelamento solicitado pelo contribuinte';

      const envelope = buildCancelarEnvelope(chNFSe, cnpj, cMotivo, xMotivo, tpAmb);
      const soapResp = await enviarSoapBethaCloud(
        'RecepcionarEventoCancelamento', envelope, request.certificado,
      );

      const body     = extrairBodySoap(soapResp);
      const resposta = body?.RecepcionarEventoCancelamentoResposta ?? body;
      const mensagens = extrairMensagens(resposta);
      const statusResp = resposta?.status ? String(resposta.status) : '';

      if (statusResp === 'CANCELADO' || statusResp === 'OK') {
        return { success: true, status: 'cancelado', mensagens: mensagens.length > 0 ? mensagens : undefined };
      }

      if (mensagens.length > 0) {
        return { success: false, status: 'rejeitado', mensagens };
      }

      // Resposta sem status explícito — assume cancelado se não houve erro
      return { success: true, status: 'cancelado' };
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro no cancelamento via Betha Cloud' }],
      };
    }
  }

  async consultar(request: NfseConsultarNfseRequest): Promise<NfseResponse> {
    try {
      const tpAmb      = (request.ambiente || config.sefazAmbiente) === 'producao' ? '1' : '2';
      const cnpj       = apenasNumeros(request.prestador.cnpj);
      const codigoIbge = request.codigoMunicipio || '';
      const protocolo  = request.protocolo || String(request.numero || '');

      if (!protocolo) {
        return {
          success: false,
          status: 'erro',
          mensagens: [{ codigo: '0', mensagem: 'Protocolo ou número da NFS-e é obrigatório para consultar via Betha Cloud' }],
        };
      }

      const envelope = buildConsultarStatusEnvelope(protocolo, codigoIbge, cnpj, tpAmb);
      const soapResp = await enviarSoapBethaCloud('ConsultarStatusDps', envelope, request.certificado);
      const { status, numeroNotaFiscal, chaveAcesso, linkPdf, mensagens } =
        parseConsultarStatusResposta(soapResp);

      if (numeroNotaFiscal) {
        return {
          success: true,
          status: 'autorizado',
          numeroNfse: Number(numeroNotaFiscal),
          codigoVerificacao: chaveAcesso,
          linkVisualizacao: linkPdf,
        };
      }

      return {
        success: false,
        status: 'processando',
        mensagens: mensagens.length > 0
          ? mensagens
          : [{ codigo: '0', mensagem: `Status Betha Cloud: ${status || 'desconhecido'}` }],
      };
    } catch (error: any) {
      return {
        success: false,
        status: 'erro',
        mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na consulta via Betha Cloud' }],
      };
    }
  }
}
