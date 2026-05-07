import * as forge from 'node-forge';

export interface ParsedPfx {
  privateKey: string;
  certificate: string;
  chain: string[];
  notBefore: Date;
  notAfter: Date;
  subject: string;
  issuer: string;
  serialNumber: string;
  cnpj?: string;
}

/**
 * Parse a PFX (PKCS#12) into PEM-encoded key + cert plus metadata.
 *
 * Note: this version is intentionally cache-free — the certificate module is
 * the one that decides when to cache decrypted PFX bytes (with strict TTL +
 * audit trail). Lower-level helpers should be deterministic and stateless.
 */
export function parsePfx(pfxBase64: string, password: string): ParsedPfx {
  const pfxBuf = Buffer.from(pfxBase64, 'base64');
  const pfxDer = forge.util.createBuffer(pfxBuf.toString('binary'));
  const pkcs12Asn1 = forge.asn1.fromDer(pfxDer);
  const pkcs12 = forge.pkcs12.pkcs12FromAsn1(pkcs12Asn1, password);

  const keyBags = pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
  if (!keyBag || keyBag.length === 0 || !keyBag[0].key) {
    throw new Error('Chave privada não encontrada no certificado');
  }
  const privateKey = forge.pki.privateKeyToPem(keyBag[0].key);

  const certBags = pkcs12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag];
  if (!certBag || certBag.length === 0 || !certBag[0].cert) {
    throw new Error('Certificado não encontrado no arquivo PFX');
  }

  const cert = certBag[0].cert;
  const certificate = forge.pki.certificateToPem(cert);
  const chain = certBag.slice(1).filter((b) => b.cert).map((b) => forge.pki.certificateToPem(b.cert!));

  const subject = cert.subject.getField('CN')?.value ?? '';
  const issuer = cert.issuer.getField('CN')?.value ?? '';
  const cnpj = extrairCnpj(cert, subject);

  return {
    privateKey,
    certificate,
    chain,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    subject,
    issuer,
    serialNumber: cert.serialNumber,
    cnpj,
  };
}

export function pfxToBuffer(pfxBase64: string): Buffer {
  return Buffer.from(pfxBase64, 'base64');
}

function extrairCnpj(cert: forge.pki.Certificate, subjectCN: string): string | undefined {
  try {
    const san = cert.extensions.find((e) => e.name === 'subjectAltName');
    if (san && Array.isArray(san.altNames)) {
      for (const alt of san.altNames as Array<{ oid?: string; value?: string }>) {
        if (alt.oid === '2.16.76.1.3.3' && typeof alt.value === 'string') {
          const digits = alt.value.replace(/\D/g, '');
          if (digits.length >= 22) return digits.slice(8, 22);
          if (digits.length === 14) return digits;
        }
      }
    }
  } catch {
    /* swallow — fall through to CN regex */
  }
  const m = subjectCN.match(/(\d{14})/);
  return m ? m[1] : undefined;
}
