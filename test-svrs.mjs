/**
 * Script de diagnóstico: testa conectividade e autenticação com SVRS NFC-e
 *
 * Uso:
 *   node test-svrs.mjs <caminho-do-pfx> <senha> [uf]
 *
 * Exemplos:
 *   node test-svrs.mjs /path/to/cert.pfx minha-senha SC
 *   node test-svrs.mjs cert.pfx senha123 SC
 */

import https from 'https';
import fs from 'fs';
import path from 'path';

const [,, pfxPath, password, uf = 'SC'] = process.argv;

if (!pfxPath || !password) {
  console.error('Uso: node test-svrs.mjs <caminho-do-pfx> <senha> [uf]');
  process.exit(1);
}

const pfxBuffer = fs.readFileSync(pfxPath);

// URLs para testar
const URLS = {
  'NFC-e Status (homologação)': {
    url: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
  },
  'NFC-e Status (produção)': {
    url: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
  },
  'NFC-e Autorizacao (produção)': {
    url: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao4/NFeAutorizacao4.asmx',
    action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
  },
};

const UF_CODES = {
  SC: '42', SP: '35', RS: '43', PR: '41', MG: '31', RJ: '33',
  GO: '52', BA: '29', PE: '26', CE: '23', MA: '21', PA: '15',
};

function buildStatusBody(ufCode, tpAmb = '1') {
  const SEFAZ_NS = 'http://www.portalfiscal.inf.br/nfe';
  const STATUS_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4';

  const body = `<nfeDadosMsg xmlns="${STATUS_NS}">` +
    `<consStatServ xmlns="${SEFAZ_NS}" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUF>${ufCode}</cUF>` +
    `<xServ>STATUS</xServ>` +
    `</consStatServ>` +
    `</nfeDadosMsg>`;

  return `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>${body}</soap:Body>` +
    `</soap:Envelope>`;
}

async function testUrl(name, config, ufCode, tpAmb = '1') {
  const { url, action } = config;
  const envelope = buildStatusBody(ufCode, tpAmb);

  const urlObj = new URL(url);
  const agent = new https.Agent({
    pfx: pfxBuffer,
    passphrase: password,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
  });

  return new Promise((resolve) => {
    const startTime = Date.now();
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `"${action}"`,
        'Content-Length': Buffer.byteLength(envelope, 'utf-8'),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const duration = Date.now() - startTime;
        resolve({ status: res.statusCode, body: data, duration });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 'ERROR', body: err.message, duration: Date.now() - startTime });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      resolve({ status: 'TIMEOUT', body: 'Request timeout after 30s', duration: 30000 });
    });

    req.write(envelope);
    req.end();
  });
}

// Also test without cert to see base behavior
async function testWithoutCert(name, url) {
  const urlObj = new URL(url);
  return new Promise((resolve) => {
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'GET',
      rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data.slice(0, 200) });
      });
    });

    req.on('error', (err) => {
      resolve({ status: 'ERROR', body: err.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ status: 'TIMEOUT', body: 'timeout' });
    });

    req.end();
  });
}

async function main() {
  const ufCode = UF_CODES[uf.toUpperCase()];
  if (!ufCode) {
    console.error(`UF inválida: ${uf}. Use SC, SP, RS, etc.`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log(`Diagnóstico SVRS NFC-e`);
  console.log(`PFX: ${pfxPath}`);
  console.log(`UF: ${uf} (cUF: ${ufCode})`);
  console.log('='.repeat(60));

  // Test each URL
  for (const [name, config] of Object.entries(URLS)) {
    // Determine tpAmb based on name
    const tpAmb = name.includes('homologação') ? '2' : '1';

    console.log(`\n--- ${name} ---`);
    console.log(`URL: ${config.url}`);

    // First test without cert
    const noCertResult = await testWithoutCert(name, config.url);
    console.log(`GET (sem cert): HTTP ${noCertResult.status}`);

    // Then test with cert
    const withCertResult = await testUrl(name, config, ufCode, tpAmb);
    console.log(`POST SOAP (com cert): HTTP ${withCertResult.status} (${withCertResult.duration}ms)`);

    if (withCertResult.status !== 200) {
      console.log(`Response body (primeiros 500 chars): ${String(withCertResult.body).slice(0, 500)}`);
    } else {
      // Parse for cStat
      const cStat = String(withCertResult.body).match(/<cStat>(\d+)<\/cStat>/);
      const xMotivo = String(withCertResult.body).match(/<xMotivo>(.*?)<\/xMotivo>/);
      if (cStat) {
        console.log(`✓ cStat: ${cStat[1]} - ${xMotivo?.[1] || '(motivo não encontrado)'}`);
      } else {
        console.log(`Response (primeiros 500): ${String(withCertResult.body).slice(0, 500)}`);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Diagnóstico concluído');
}

main().catch(console.error);
