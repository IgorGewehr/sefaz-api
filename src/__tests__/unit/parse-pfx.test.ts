/**
 * parsePfx — seleção do cert-FOLHA dentro do PFX.
 *
 * PFX gerado por algumas ACs traz a cadeia (raiz/intermediária) ANTES do
 * certificado do titular. Pegar o [0] cegamente assinava com a CA → rejeição
 * de assinatura na SEFAZ. A seleção correta: cert cuja chave pública casa
 * com a privada; fallback: primeiro não-CA; fallback final: [0].
 * Também aceita chave em keyBag (não criptografada) além do
 * pkcs8ShroudedKeyBag padrão.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { parsePfx } from '../../lib/utils';

const PASSWORD = 'senha-teste';

interface Material {
  caCert: forge.pki.Certificate;
  leafCert: forge.pki.Certificate;
  leafKeys: forge.pki.rsa.KeyPair;
}

function gerarCadeia(): Material {
  // 1024 bits: suficiente pro teste e bem mais rápido que 2048
  const caKeys = forge.pki.rsa.generateKeyPair(1024);
  const caCert = forge.pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = '01';
  caCert.validity.notBefore = new Date(Date.now() - 86400_000);
  caCert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
  const caAttrs = [{ name: 'commonName', value: 'AC TESTE RFB' }];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }]);
  caCert.sign(caKeys.privateKey, forge.md.sha256.create());

  const leafKeys = forge.pki.rsa.generateKeyPair(1024);
  const leafCert = forge.pki.createCertificate();
  leafCert.publicKey = leafKeys.publicKey;
  leafCert.serialNumber = '02';
  leafCert.validity.notBefore = new Date(Date.now() - 86400_000);
  leafCert.validity.notAfter = new Date(Date.now() + 365 * 86400_000);
  leafCert.setSubject([{ name: 'commonName', value: 'EMPRESA TESTE:12345678000195' }]);
  leafCert.setIssuer(caAttrs);
  leafCert.setExtensions([{ name: 'basicConstraints', cA: false }]);
  leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

  return { caCert, leafCert, leafKeys };
}

function toPfxBase64(
  key: forge.pki.rsa.PrivateKey,
  certs: forge.pki.Certificate[],
  password: string | null,
): string {
  // password null → node-forge emite keyBag (chave em claro); sem MAC,
  // senão a verificação com senha vazia falha no parse.
  const opts = password ? { algorithm: '3des' as const } : { useMac: false, algorithm: '3des' as const };
  const p12 = forge.pkcs12.toPkcs12Asn1(key, certs, password, opts);
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64');
}

let material: Material;

beforeAll(() => {
  material = gerarCadeia();
});

describe('parsePfx — cert-folha por casamento de chave', () => {
  it('seleciona a FOLHA mesmo com a CA vindo antes no PFX', () => {
    const { caCert, leafCert, leafKeys } = material;
    // Ordem hostil: CA primeiro (como alguns geradores exportam)
    const pfx = toPfxBase64(leafKeys.privateKey, [caCert, leafCert], PASSWORD);

    const parsed = parsePfx(pfx, PASSWORD);

    expect(parsed.subject).toBe('EMPRESA TESTE:12345678000195');
    expect(parsed.serialNumber).toBe(leafCert.serialNumber);
    expect(parsed.cnpj).toBe('12345678000195');
    // a CA vai pra chain, não pro certificate
    expect(parsed.chain).toHaveLength(1);
    expect(parsed.chain[0]).toContain('CERTIFICATE');
  });

  it('chave privada retornada casa com o certificado selecionado (assina/verifica)', () => {
    const { caCert, leafCert, leafKeys } = material;
    const pfx = toPfxBase64(leafKeys.privateKey, [caCert, leafCert], PASSWORD);

    const parsed = parsePfx(pfx, PASSWORD);

    const assinatura = crypto.createSign('RSA-SHA256').update('payload').sign(parsed.privateKey, 'base64');
    const publicPem = forge.pki.publicKeyToPem(leafCert.publicKey as forge.pki.rsa.PublicKey);
    expect(crypto.createVerify('RSA-SHA256').update('payload').verify(publicPem, assinatura, 'base64')).toBe(true);
  });

  it('PFX só com a folha continua funcionando (caso comum)', () => {
    const { leafCert, leafKeys } = material;
    const pfx = toPfxBase64(leafKeys.privateKey, [leafCert], PASSWORD);

    const parsed = parsePfx(pfx, PASSWORD);

    expect(parsed.subject).toBe('EMPRESA TESTE:12345678000195');
    expect(parsed.chain).toHaveLength(0);
  });

  it('aceita chave em keyBag (PFX sem criptografia da chave)', () => {
    const { caCert, leafCert, leafKeys } = material;
    // password null → node-forge emite keyBag em vez de pkcs8ShroudedKeyBag
    const pfx = toPfxBase64(leafKeys.privateKey, [caCert, leafCert], null);

    const parsed = parsePfx(pfx, '');

    expect(parsed.subject).toBe('EMPRESA TESTE:12345678000195');
    expect(parsed.privateKey).toContain('PRIVATE KEY');
  });
});
