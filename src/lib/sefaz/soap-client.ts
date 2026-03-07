import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { pfxToBuffer } from '../utils';
import type { CertificateData } from '../../types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/**
 * Envia requisição SOAP para o webservice SEFAZ.
 * Usa mutual TLS com o certificado digital A1 (.pfx).
 */
export async function enviarSoap(
  url: string,
  soapAction: string,
  xmlBody: string,
  certificado: CertificateData,
): Promise<string> {
  const pfx = pfxToBuffer(certificado.pfxBase64);

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    ${xmlBody}
  </soap12:Body>
</soap12:Envelope>`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      pfx,
      passphrase: certificado.password,
      headers: {
        'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
        'Content-Length': Buffer.byteLength(soapEnvelope, 'utf-8'),
      },
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`SEFAZ retornou status ${res.statusCode}: ${data.slice(0, 500)}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Erro de conexão com SEFAZ: ${err.message}`));
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout na conexão com SEFAZ (60s)'));
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
