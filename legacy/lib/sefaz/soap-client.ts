import * as https from 'https';
import * as crypto from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { pfxToBuffer } from '../utils';
import type { CertificateData } from '../../types';
import { logSoapRequest, logSoapResponse, logSoapError } from '../logger/soap-logger';
import { assertClosed, recordSuccess, recordFailure } from './circuit-breaker';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

// =====================================================
// HTTPS AGENT CACHE WITH KEEP-ALIVE
// =====================================================

const AGENT_CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const AGENT_CACHE_MAX = parseInt(process.env.AGENT_CACHE_MAX || '200', 10);

interface AgentCacheEntry {
  agent: https.Agent;
  expiresAt: number;
}

const agentCache = new Map<string, AgentCacheEntry>();

/**
 * Creates a cache key from certificate data
 */
function getAgentCacheKey(pfxBase64: string, password: string): string {
  return crypto
    .createHash('sha256')
    .update(pfxBase64 + password)
    .digest('hex');
}

/**
 * Gets or creates a reusable HTTPS Agent for the given certificate.
 * Agents are cached with keep-alive enabled to reuse connections.
 */
function getOrCreateAgent(certificado: CertificateData): https.Agent {
  const key = getAgentCacheKey(certificado.pfxBase64, certificado.password);
  const cached = agentCache.get(key);

  // Check if cached agent is still valid
  if (cached && Date.now() < cached.expiresAt) {
    return cached.agent;
  }

  // Create new agent with keep-alive
  const pfx = pfxToBuffer(certificado.pfxBase64);
  const agent = new https.Agent({
    pfx,
    passphrase: certificado.password,
    rejectUnauthorized: false, // ICP-Brasil root CAs are not in Node.js default bundle
    minVersion: 'TLSv1.2',
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 10,
    timeout: 45000,
  });

  // LRU: remove oldest entry if at capacity
  if (agentCache.size >= AGENT_CACHE_MAX && !agentCache.has(key)) {
    const oldestKey = agentCache.keys().next().value;
    if (oldestKey !== undefined) {
      const old = agentCache.get(oldestKey);
      old?.agent.destroy();
      agentCache.delete(oldestKey);
    }
  }
  agentCache.delete(key);
  agentCache.set(key, {
    agent,
    expiresAt: Date.now() + AGENT_CACHE_TTL_MS,
  });

  return agent;
}

/**
 * Envia requisição SOAP para o webservice SEFAZ.
 * Usa mutual TLS com o certificado digital A1 (.pfx).
 * Uses cached HTTPS Agent with keep-alive for connection reuse.
 */
export async function enviarSoap(
  url: string,
  soapAction: string,
  xmlBody: string,
  certificado: CertificateData,
  soapVersion: '1.1' | '1.2' = '1.2',
): Promise<string> {
  const startTime = Date.now();

  const isSoap12 = soapVersion === '1.2';
  const soapNs = isSoap12
    ? 'http://www.w3.org/2003/05/soap-envelope'
    : 'http://schemas.xmlsoap.org/soap/envelope/';
  const soapPrefix = isSoap12 ? 'soap12' : 'soap';

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<${soapPrefix}:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:${soapPrefix}="${soapNs}">
  <${soapPrefix}:Body>
    ${xmlBody}
  </${soapPrefix}:Body>
</${soapPrefix}:Envelope>`;

  // Log request
  logSoapRequest(url, soapAction, xmlBody);

  // Circuit breaker: falha rápido se o endpoint está degradado
  try {
    assertClosed(url);
  } catch (err: any) {
    logSoapError(url, soapAction, err, 0);
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    // Get or create reusable agent with keep-alive
    const agent = getOrCreateAgent(certificado);

    const contentType = isSoap12
      ? `application/soap+xml; charset=utf-8; action="${soapAction}"`
      : 'text/xml; charset=utf-8';

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      agent,
      headers: isSoap12
        ? {
            'Content-Type': contentType,
            'Content-Length': Buffer.byteLength(soapEnvelope, 'utf-8'),
          }
        : {
            'Content-Type': contentType,
            'SOAPAction': `"${soapAction}"`,
            'Content-Length': Buffer.byteLength(soapEnvelope, 'utf-8'),
          },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const duration = Date.now() - startTime;

        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          // 2xx → sucesso; limpa contador de falhas
          recordSuccess(url);
          logSoapResponse(url, soapAction, res.statusCode, data, duration);
          resolve(data);
        } else {
          logSoapResponse(url, soapAction, res.statusCode || 500, data, duration);
          // 4xx normalmente é erro de payload nosso; só conta como falha de infra se for 5xx
          if (res.statusCode && res.statusCode >= 500) {
            recordFailure(url);
          } else {
            recordSuccess(url);
          }
          const error = new Error(`SEFAZ retornou status ${res.statusCode}: ${data.slice(0, 500)}`);
          logSoapError(url, soapAction, error, duration);
          reject(error);
        }
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      recordFailure(url);
      const error = new Error(`Erro de conexão com SEFAZ: ${err.message}`);
      logSoapError(url, soapAction, error, duration);
      reject(error);
    });

    req.setTimeout(60000, () => {
      req.destroy();
      const duration = Date.now() - startTime;
      recordFailure(url);
      const error = new Error('Timeout na conexão com SEFAZ (60s)');
      logSoapError(url, soapAction, error, duration);
      reject(error);
    });

    req.write(soapEnvelope);
    req.end();
  });
}

/**
 * Extrai o conteúdo do SOAP Body da resposta
 */
export function extrairBodySoap(soapResponse: string): any {
  const parsed = xmlParser.parse(soapResponse);

  // Navegar pela estrutura SOAP: Envelope > Body > conteúdo
  const envelope = parsed['Envelope'] || parsed['soap:Envelope'] || parsed['soap12:Envelope'];
  if (!envelope) {
    throw new Error('Resposta SEFAZ inválida: envelope SOAP não encontrado');
  }

  const body = envelope['Body'] || envelope['soap:Body'] || envelope['soap12:Body'];
  if (!body) {
    throw new Error('Resposta SEFAZ inválida: body SOAP não encontrado');
  }

  return body;
}

/**
 * Extrai o XML de retorno do nfeResultMsg (padrão SEFAZ NFe/NFCe)
 */
export function extrairRetorno(soapResponse: string): any {
  const body = extrairBodySoap(soapResponse);

  // O retorno pode estar em diferentes tags dependendo do serviço
  // Tentar encontrar a tag de resultado
  const keys = Object.keys(body);
  for (const key of keys) {
    const inner = body[key];
    if (inner && typeof inner === 'object') {
      // Procurar nfeResultMsg ou similar
      if (inner['nfeResultMsg'] || inner['mdfeResultMsg']) {
        const resultMsg = inner['nfeResultMsg'] || inner['mdfeResultMsg'];
        if (typeof resultMsg === 'string') {
          return xmlParser.parse(resultMsg);
        }
        return resultMsg;
      }
      // Retornar o primeiro objeto encontrado no body
      return inner;
    }
  }

  return body;
}

export { xmlParser };
