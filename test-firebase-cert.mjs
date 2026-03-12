/**
 * Diagnóstico SVRS NFC-e com cert do Firebase
 *
 * Baixa o certificado do Firebase Storage, decripta a senha e testa
 * endpoints SVRS diretamente.
 *
 * Uso:
 *   TENANT_ID=<id> node test-firebase-cert.mjs
 *
 * Requer que o arquivo firebase-service-account.json exista no diretório atual,
 * ou que FIREBASE_SERVICE_ACCOUNT_JSON esteja definido como env var.
 */

import https from 'https';
import { createDecipheriv } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// =====================================================
// Config from env
// =====================================================

const TENANT_ID = process.env.TENANT_ID;
const CERT_KEY_HEX = '1190345fbb86654b3b50e90e8550d367803a85082c9e5890ae96d022df47f057';

// Firebase service account (embedded from gestao-raiz .env.local)
const FIREBASE_SERVICE_ACCOUNT = {
  "type": "service_account",
  "project_id": "gestao-raiz",
  "private_key_id": "fc2b5ca50b100d33adf9fb3853642aabd1b86767",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDT7s7KAhgVJwlM\nA7P3clD1SYI+G6bQY5c/XR1USra9I8EaqqIY/FEjpVhcHIgK8esyMvJxT2XeKuBF\nGD718S6wPqfqh+mvMaxA/kamlccllgNJ1jhgRwZ14z7l9rW2MAoV+py6RKAE8ssO\nlEXW5qEMYsVTPDar296ptFDuhK+ngldSD6n/8eCuMbx6QlHImb/ua+oqg/TGT1Ry\nxaXEz896GbRgHWU3BtWoNyvj17bY6sA6vf+ap6HRX7pvN4Jkl2MiuxZAEQZkBB/l\nm3bv87joM0LdR8KEeRnPfCElJtV3V4RRvSdBT0S6qJzDIXMFrG3WCg3Mf/F8O5Tt\nyMHjM7h/AgMBAAECggEASksG1q3RP2kFy03pAq9iTfpM2/TZj2e6F45Ov8PJN5iX\nEwAJ/vREhVhrFy8xSZTwvBI8BxisPyuMnuwW9iRsF4B/YKnwc2fYWJhKsA8FVtm1\noWalMKr1StI0tGy92nYQsw+9bVatOc7a++tiaClE/5CIV9td1vUmoxsA2/xLj05w\nZ7nbgsCnEKrC3uFZutDFvcnfk5i4sTCLpE3iJf9j8lKDtfLBt4p/y1ZRDutuva/P\nvC+wjbdZFGMWigxkNfkGyJe42N1giWAJYpLPv4RL1MN76Z+kDc/N4K4uL71temL9\nN+16VsdiJjdakgR96cdQha7QO03rVqbKLi+/Z7zyIQKBgQDwJbt2r4Gb4QM4aW30\n0vTGQ1kiCgynF7IBLBUpqELaMoKESoUXvQg0wo5SDc1Df6ROfbxaKgV1qvpLYgGu\nxfRgLe/rhHjaiBvWepbKBC058hOfI+GeHidJciy3DKPcLPAivLTRkFuNDXRI7vlz\nGzwMnUw0dCQ3gSdD1gBPCfd3qQKBgQDh7EadTMglDSq7fsOkS55T66mkpz+yTf2d\nNjmsOnxmc5QAJFIgp+x+vAF0teBmi0dotmTVUSqqbP8hZPCri5c2uyJKFS6QeOJO\nP1Ann9ik4We6OIYPNjSfZYh6uNeDd180421av06tyTk4vGMxNaQJF2i3mk0Tzz3C\nc4Njf8wn5wKBgQCp/3vyK5GLgEDgWTneWsut4hUh1I1aZ5q527PrdlJE1gawkXQf\n9s/tUWCgU2bgBmaQrc984ExXHL7sSCe6yiURRNOXHILU6A8UyFkgDs7ZOzWKrULU\nxLG4+1sOBaOlhCZF4OH7i75TXpfX3Vu2kSv0HhHI/AJ7TDE4gzBaw0psaQKBgQCo\nXFK3UIvqiKhqt2oGms+vjHSMnpKqRtKUAN/zyFYCZ2lIvchyS5HDVEnldtB2up6J\nmzsDeQxJmxZ6BWYRAOK8R7Ki8KwVv/AuDaKnFMj2/n81WIAW//cxPhH6GpuIfkH2\nAPHyaZSxj75T2Jg3CNloaQiBoryD4bINodWtJYS3ywKBgQDJS1t/Urc0ITcoRgky\ntZyZKXenzFY8OF9OF5XuY25IO3SBY9I+2CGsEOuuHGfEPjTSq5EZhr8aHW2aa0sV\nJyxf/rUAaF8Xon5uoFkOpGVZUvF5xw3+QT1Ag+4td/csTHtF3EmbMlOiyfTSfO3A\nhPdWThwmoBMBXtZozh9qMasIvw==\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@gestao-raiz.iam.gserviceaccount.com",
  "client_id": "113561178718108395353",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40gestao-raiz.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

// =====================================================
// AES-256-GCM Decrypt (same as cert-password.ts)
// =====================================================

function decryptCertPassword(encrypted) {
  const key = Buffer.from(CERT_KEY_HEX, 'hex');
  const parts = encrypted.split('.');
  if (parts.length !== 3) throw new Error('Formato inválido');
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// =====================================================
// SOAP helpers
// =====================================================

const UF_CODES = {
  SC: '42', SP: '35', RS: '43', PR: '41', MG: '31', RJ: '33',
  GO: '52', BA: '29', PE: '26', CE: '23', MA: '21', PA: '15',
};

function buildStatusEnvelope(ufCode, tpAmb) {
  const body = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">` +
    `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUF>${ufCode}</cUF>` +
    `<xServ>STATUS</xServ>` +
    `</consStatServ>` +
    `</nfeDadosMsg>`;

  return `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>${body}</soap:Body>` +
    `</soap:Envelope>`;
}

async function soapRequest(url, action, envelope, pfxBuffer, password) {
  return new Promise((resolve) => {
    const agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase: password,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    });

    const urlObj = new URL(url);
    const start = Date.now();

    const req = https.request({
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
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, ms: Date.now() - start }));
    });

    req.on('error', err => resolve({ status: 'ERR', body: err.message, ms: Date.now() - start }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 'TIMEOUT', body: '', ms: 20000 }); });

    req.write(envelope);
    req.end();
  });
}

// =====================================================
// Main
// =====================================================

async function main() {
  // Init Firebase Admin
  let app;
  try {
    app = initializeApp({ credential: cert(FIREBASE_SERVICE_ACCOUNT), storageBucket: 'gestao-raiz.firebasestorage.app' });
  } catch (e) {
    if (e.code === 'app/duplicate-app') {
      app = require('firebase-admin').app();
    } else {
      throw e;
    }
  }

  const db = getFirestore(app);
  const storage = getStorage(app);

  // Find tenant or use provided ID
  let tenantId = TENANT_ID;
  if (!tenantId) {
    console.log('Listando tenants com certificados...\n');
    const snap = await db.collection('tenants').get();
    const withCert = snap.docs.filter(d => d.data()?.fiscal?.certificate?.storagePath);
    if (withCert.length === 0) {
      console.error('Nenhum tenant com certificado encontrado');
      process.exit(1);
    }
    withCert.forEach(d => {
      const data = d.data();
      console.log(`  ID: ${d.id} | UF: ${data.address?.state} | env: ${data.fiscal?.nfceConfig?.environment} | cert: ${data.fiscal?.certificate?.subject}`);
    });
    console.log('\nDefina TENANT_ID=<id> e rode novamente');
    process.exit(0);
  }

  // Get tenant data
  const tenantSnap = await db.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) {
    console.error(`Tenant não encontrado: ${tenantId}`);
    process.exit(1);
  }
  const tenantData = tenantSnap.data();
  const storagePath = tenantData?.fiscal?.certificate?.storagePath;
  const certPasswordEncrypted = tenantData?.fiscal?.certPasswordEncrypted;
  const uf = tenantData?.address?.state || 'SC';
  const nfceEnv = tenantData?.fiscal?.nfceConfig?.environment;

  console.log('='.repeat(60));
  console.log(`Tenant: ${tenantId}`);
  console.log(`UF: ${uf}`);
  console.log(`NFC-e env: ${nfceEnv}`);
  console.log(`Cert subject: ${tenantData?.fiscal?.certificate?.subject || 'N/A'}`);
  console.log(`Cert expires: ${tenantData?.fiscal?.certificate?.expiresAt?.toDate?.()?.toISOString() || 'N/A'}`);

  if (!storagePath || !certPasswordEncrypted) {
    console.error('Certificado não configurado para este tenant');
    process.exit(1);
  }

  // Decrypt password
  const password = decryptCertPassword(certPasswordEncrypted);
  console.log(`Password: ${password.replace(/./g, '*')}`);

  // Download PFX
  console.log(`Downloading cert from: ${storagePath}...`);
  const bucket = storage.bucket();
  const [pfxBuffer] = await bucket.file(storagePath).download();
  console.log(`PFX downloaded: ${pfxBuffer.length} bytes`);

  const ufCode = UF_CODES[uf.toUpperCase()] || '42';
  const tpAmb = (nfceEnv === 'production' || nfceEnv === 'producao') ? '1' : '2';

  console.log('='.repeat(60));

  // Test URLs
  const tests = [
    {
      name: `NFC-e Status (${tpAmb === '1' ? 'produção' : 'homologação'} - correto)`,
      url: tpAmb === '1'
        ? 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx'
        : 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx',
      action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
    },
    {
      name: `NFC-e Autorizacao (${tpAmb === '1' ? 'produção' : 'homologação'} - correto)`,
      url: tpAmb === '1'
        ? 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao4/NFeAutorizacao4.asmx'
        : 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao4/NFeAutorizacao4.asmx',
      action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
    },
    // Test cross-environments to diagnose cert environment mismatch
    {
      name: 'NFC-e Status (homologação, tpAmb=2, com cert produção)',
      url: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx',
      action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
      forceTpAmb: '2',
    },
    {
      name: 'NFC-e Status (produção, tpAmb=1, com cert produção)',
      url: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico4/NfeStatusServico4.asmx',
      action: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
      forceTpAmb: '1',
    },
  ];

  for (const test of tests) {
    const testTpAmb = test.forceTpAmb || tpAmb;
    const envelope = buildStatusEnvelope(ufCode, testTpAmb);
    console.log(`\n--- ${test.name} ---`);
    console.log(`URL: ${test.url}`);

    const result = await soapRequest(test.url, test.action, envelope, pfxBuffer, password);
    const statusIcon = result.status === 200 ? '✓' : '✗';
    console.log(`${statusIcon} HTTP ${result.status} (${result.ms}ms)`);

    if (result.status === 200) {
      const cStat = result.body.match(/<cStat>(\d+)<\/cStat>/);
      const xMotivo = result.body.match(/<xMotivo>(.*?)<\/xMotivo>/);
      if (cStat) {
        console.log(`  cStat: ${cStat[1]} - ${xMotivo?.[1] || ''}`);
      } else {
        console.log(`  Response (500 chars): ${result.body.slice(0, 500)}`);
      }
    } else {
      console.log(`  Response (500 chars): ${String(result.body).slice(0, 500)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  process.exit(0);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
