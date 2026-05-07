import { Injectable, Logger } from '@nestjs/common';
import * as https from 'node:https';
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { CircuitBreakerService } from './circuit-breaker.service';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

const AGENT_CACHE_TTL_MS = 8 * 60 * 60 * 1000;
const AGENT_CACHE_MAX = parseInt(process.env.AGENT_CACHE_MAX ?? '200', 10);

interface AgentCacheEntry {
  agent: https.Agent;
  expiresAt: number;
}

export interface SoapCertInputs {
  pfxBase64: string;
  password: string;
}

@Injectable()
export class SoapClientService {
  private readonly logger = new Logger(SoapClientService.name);
  private readonly agentCache = new Map<string, AgentCacheEntry>();

  constructor(private readonly breaker: CircuitBreakerService) {}

  async send(
    url: string,
    soapAction: string,
    xmlBody: string,
    cert: SoapCertInputs,
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

    this.breaker.assertClosed(url);

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const agent = this.getOrCreateAgent(cert);

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
              SOAPAction: `"${soapAction}"`,
              'Content-Length': Buffer.byteLength(soapEnvelope, 'utf-8'),
            },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const duration = Date.now() - startTime;
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            this.breaker.recordSuccess(url);
            this.logger.debug(`SEFAZ ${soapAction} ${res.statusCode} (${duration}ms)`);
            resolve(data);
          } else {
            if (res.statusCode && res.statusCode >= 500) this.breaker.recordFailure(url);
            else this.breaker.recordSuccess(url);
            reject(new Error(`SEFAZ ${res.statusCode}: ${data.slice(0, 500)}`));
          }
        });
      });

      req.on('error', (err) => {
        this.breaker.recordFailure(url);
        reject(new Error(`Erro de conexão SEFAZ: ${err.message}`));
      });

      req.setTimeout(60000, () => {
        req.destroy();
        this.breaker.recordFailure(url);
        reject(new Error('Timeout SEFAZ (60s)'));
      });

      req.write(soapEnvelope);
      req.end();
    });
  }

  parseEnvelopeBody(soapResponse: string): unknown {
    const parsed = xmlParser.parse(soapResponse);
    const envelope =
      (parsed as Record<string, unknown>)['Envelope'] ??
      (parsed as Record<string, unknown>)['soap:Envelope'] ??
      (parsed as Record<string, unknown>)['soap12:Envelope'];
    if (!envelope) throw new Error('Resposta SEFAZ inválida: envelope SOAP não encontrado');
    const env = envelope as Record<string, unknown>;
    const body = env['Body'] ?? env['soap:Body'] ?? env['soap12:Body'];
    if (!body) throw new Error('Resposta SEFAZ inválida: body SOAP não encontrado');
    return body;
  }

  private getOrCreateAgent(cert: SoapCertInputs): https.Agent {
    const key = createHash('sha256').update(cert.pfxBase64 + cert.password).digest('hex');
    const cached = this.agentCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.agent;

    const pfx = Buffer.from(cert.pfxBase64, 'base64');
    const agent = new https.Agent({
      pfx,
      passphrase: cert.password,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 10,
      timeout: 45000,
    });

    if (this.agentCache.size >= AGENT_CACHE_MAX && !this.agentCache.has(key)) {
      const oldestKey = this.agentCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.agentCache.get(oldestKey)?.agent.destroy();
        this.agentCache.delete(oldestKey);
      }
    }
    this.agentCache.delete(key);
    this.agentCache.set(key, { agent, expiresAt: Date.now() + AGENT_CACHE_TTL_MS });
    return agent;
  }
}
