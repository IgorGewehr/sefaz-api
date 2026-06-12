/**
 * Contingência off-line NFC-e (tpEmis=9): o QR Code é OBRIGATÓRIO também em
 * contingência — infNFeSupl é grupo obrigatório do modelo 65; sem ele a
 * transmissão posterior é rejeitada por schema. Desde a NT 2025.001 o QR Code
 * versão 3 é obrigatório em produção (01/09/2025), inclusive em contingência.
 * Leiaute off-line v3 (referências: sped-nfe QRCode::get300 ramo tpEmis==9 e
 * ACBr TACBrNFe.GetURLQRCodeV3):
 *
 *   url?p=chNFe|3|tpAmb|diaDhEmi|vNF|tpIdDest|cDest|assinatura
 *
 * onde assinatura = RSA-SHA1("chNFe|3|tpAmb|dia|vNF|tpIdDest|cDest") com a
 * chave privada do certificado do emitente, em base64. CSC/idCSC/hash/digVal
 * saíram do leiaute v3.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';
import * as forge from 'node-forge';
import { buildNFCeSuplContingencia } from '../../lib/nfe/xml-builder';
import { prepararNFCeContingencia } from '../../services/nfe.service';
import type { NFCeRequest, CertificateData } from '../../types';

const CHAVE = '35260612345678000195650010000001239100000017';
const CSC = { id: '000001', token: 'A1B2C3D4-E5F6-A7B8-C9D0-E1F2A3B4C5D6' };
const PFX_PASSWORD = 'senha-teste';

// ============================================================
// PFX de teste (gerado uma vez — keygen RSA é caro)
// ============================================================

function gerarPfxTeste(): { certificado: CertificateData; certPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [
    { name: 'commonName', value: 'EMPRESA TESTE:12345678000195' },
    { name: 'countryName', value: 'BR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PFX_PASSWORD, { algorithm: '3des' });
  const der = forge.asn1.toDer(p12).getBytes();
  return {
    certificado: { pfxBase64: Buffer.from(der, 'binary').toString('base64'), password: PFX_PASSWORD },
    certPem: forge.pki.certificateToPem(cert),
  };
}

let pfx: { certificado: CertificateData; certPem: string };
function pfxTeste(): { certificado: CertificateData; certPem: string } {
  if (!pfx) pfx = gerarPfxTeste();
  return pfx;
}

/** Extrai os campos do parâmetro ?p= do qrCode dentro do infNFeSupl. */
function camposDoQR(supl: string): string[] {
  const m = supl.match(/<qrCode>([^<]+)<\/qrCode>/);
  expect(m, 'infNFeSupl deve conter <qrCode>').not.toBeNull();
  const p = m![1].split('?p=')[1];
  expect(p, 'qrCode deve ter parâmetro ?p=').toBeDefined();
  return p.split('|');
}

function verificaAssinatura(campos: string[], certPem: string): boolean {
  const seq = campos.slice(0, 7).join('|');
  return crypto.createVerify('RSA-SHA1').update(seq, 'utf8').verify(certPem, campos[7], 'base64');
}

function suplPadrao(overrides: Partial<Parameters<typeof buildNFCeSuplContingencia>[0]> = {}): string {
  return buildNFCeSuplContingencia({
    chaveAcesso: CHAVE,
    tpAmb: '2',
    uf: 'SP',
    dhEmi: '2026-06-05T14:30:00-03:00',
    vNF: '123.40',
    certificado: pfxTeste().certificado,
    ...overrides,
  });
}

describe('buildNFCeSuplContingencia — QR Code off-line (v3, NT 2025.001, tpEmis=9)', () => {
  it('monta os campos off-line na ordem chNFe|3|tpAmb|dia|vNF|tpIdDest|cDest|assinatura', () => {
    const campos = camposDoQR(suplPadrao());

    expect(campos).toHaveLength(8);
    expect(campos[0]).toBe(CHAVE);   // chave de acesso
    expect(campos[1]).toBe('3');     // versão do QR Code
    expect(campos[2]).toBe('2');     // tpAmb
    expect(campos[3]).toBe('05');    // dia do dhEmi (DD)
    expect(campos[4]).toBe('123.40');// vNF
    expect(campos[5]).toBe('');      // tpIdDest vazio (consumidor não identificado)
    expect(campos[6]).toBe('');      // cDest vazio
    expect(campos[7].length).toBeGreaterThan(0); // assinatura
  });

  it('CSC, idCSC, hash SHA-1 e digVal NÃO aparecem no leiaute v3', () => {
    const supl = suplPadrao();
    const campos = camposDoQR(supl);

    expect(campos).toHaveLength(8);
    expect(supl).not.toContain(CSC.token);
    // nenhum campo é o idCSC '1' nem um hash hex de 40 chars (SHA-1 do v2)
    expect(campos.slice(2)).not.toContain('1');
    expect(campos.some((c) => /^[0-9A-F]{40}$/.test(c))).toBe(false);
  });

  it('assinatura é RSA-SHA1 dos 7 campos, em base64 padrão, verificável com a chave pública do PFX', () => {
    const campos = camposDoQR(suplPadrao());

    expect(campos[7]).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // base64 padrão, sem url-encode
    // RSA-2048 → assinatura de 256 bytes → 344 chars em base64
    expect(campos[7]).toHaveLength(344);
    expect(verificaAssinatura(campos, pfxTeste().certPem)).toBe(true);
  });

  it('assinatura NÃO verifica se qualquer parâmetro for adulterado', () => {
    const campos = camposDoQR(suplPadrao());
    const adulterado = [...campos];
    adulterado[4] = '999.99'; // muda vNF

    expect(verificaAssinatura(adulterado, pfxTeste().certPem)).toBe(false);
  });

  it('consumidor com CPF → tpIdDest=2 e cDest com os dígitos do CPF', () => {
    const campos = camposDoQR(suplPadrao({ consumidor: { cpf: '123.456.789-09' } }));
    expect(campos[5]).toBe('2');
    expect(campos[6]).toBe('12345678909');
    expect(verificaAssinatura(campos, pfxTeste().certPem)).toBe(true);
  });

  it('consumidor com CNPJ → tpIdDest=1; CNPJ tem precedência sobre CPF (igual ao dest do XML)', () => {
    const campos = camposDoQR(
      suplPadrao({ consumidor: { cnpj: '12.345.678/0001-95', cpf: '123.456.789-09' } }),
    );
    expect(campos[5]).toBe('1');
    expect(campos[6]).toBe('12345678000195');
  });

  it('dia vem literal do dhEmi, sem deslocamento de fuso', () => {
    // 31/01 23:59 -03:00 já é 01/02 em UTC — o QR tem que manter 31.
    const campos = camposDoQR(suplPadrao({ dhEmi: '2026-01-31T23:59:59-03:00' }));
    expect(campos[3]).toBe('31');
  });

  it('vNF é normalizado para 2 casas decimais com ponto', () => {
    expect(camposDoQR(suplPadrao({ vNF: '99.9' }))[4]).toBe('99.90');
    expect(camposDoQR(suplPadrao({ vNF: '100' }))[4]).toBe('100.00');
  });

  it('inclui urlChave depois do qrCode dentro do infNFeSupl', () => {
    const supl = suplPadrao();
    expect(supl.startsWith('<infNFeSupl>')).toBe(true);
    expect(supl.endsWith('</infNFeSupl>')).toBe(true);
    expect(supl).toContain('<urlChave>');
    expect(supl.indexOf('<qrCode>')).toBeLessThan(supl.indexOf('<urlChave>'));
  });

  it('lança erro para UF sem URL de QR Code e para dhEmi malformado', () => {
    expect(() => suplPadrao({ uf: 'XX' })).toThrow(/URL de QR Code/);
    expect(() => suplPadrao({ dhEmi: '12/06/2026' })).toThrow(/dhEmi inválido/);
  });
});

// ============================================================
// Integração: prepararNFCeContingencia com certificado real
// ============================================================

function makeRequest(certificado: CertificateData): NFCeRequest {
  return {
    emitente: {
      cnpj: '12345678000195',
      nome: 'EMPRESA TESTE LTDA',
      inscricaoEstadual: '123456789012',
      crt: '1',
      endereco: {
        logradouro: 'RUA TESTE',
        numero: '100',
        bairro: 'CENTRO',
        codigoMunicipio: '3550308',
        municipio: 'SAO PAULO',
        uf: 'SP',
        cep: '01001000',
      },
    },
    itens: [
      {
        numero: 1,
        produto: {
          codigo: 'P001',
          cEAN: 'SEM GTIN',
          descricao: 'PRODUTO TESTE',
          ncm: '21069090',
          cfop: '5102',
          unidade: 'UN',
          quantidade: 2,
          valorUnitario: 50.05,
          valorTotal: 100.1,
          cEANTrib: 'SEM GTIN',
          unidadeTrib: 'UN',
          quantidadeTrib: 2,
          valorUnitarioTrib: 50.05,
          indTot: '1',
        },
        imposto: {
          icms: { orig: '0', csosn: '102' },
          pis: { cst: '49' },
          cofins: { cst: '49' },
        },
      },
    ],
    pagamento: { indicadorPagamento: '0', formas: [{ tipo: '01', valor: 100.1 }] },
    transporte: { modFrete: '9' },
    csc: CSC, // o fluxo normal (online) continua exigindo CSC — request mantém o campo
    certificado,
    ambiente: 'homologacao',
    serie: '1',
    numero: 123,
    ufEmitente: 'SP',
    contingencia: {
      dhCont: '2026-06-12T08:00:00-03:00',
      xJust: 'SEFAZ indisponivel no momento da emissao',
    },
  };
}

describe('prepararNFCeContingencia — XML assinado com infNFeSupl', () => {
  let xml: string;
  let chaveAcesso: string;

  beforeAll(async () => {
    const result = await prepararNFCeContingencia(makeRequest(pfxTeste().certificado));

    expect(result.erros).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.status).toBe('contingencia');
    expect(result.xml).toBeDefined();
    expect(result.chaveAcesso).toMatch(/^\d{44}$/);

    xml = result.xml!;
    chaveAcesso = result.chaveAcesso!;
  }, 60_000);

  it('insere infNFeSupl entre </infNFe> e <Signature>', () => {
    const idxInfNFe = xml.indexOf('</infNFe>');
    const idxSupl = xml.indexOf('<infNFeSupl>');
    const idxSig = xml.indexOf('<Signature');

    expect(idxInfNFe).toBeGreaterThan(-1);
    expect(idxSupl).toBeGreaterThan(-1);
    expect(idxSig).toBeGreaterThan(-1);
    expect(idxInfNFe).toBeLessThan(idxSupl);
    expect(idxSupl).toBeLessThan(idxSig);
    expect(xml).toContain('<urlChave>');
  });

  it('mantém tpEmis=9 + dhCont + xJust e chave com tpEmis 9', () => {
    expect(xml).toContain('<tpEmis>9</tpEmis>');
    expect(xml).toContain('<dhCont>2026-06-12T08:00:00-03:00</dhCont>');
    expect(xml).toContain('<xJust>SEFAZ indisponivel no momento da emissao</xJust>');
    expect(chaveAcesso.charAt(34)).toBe('9'); // posição do tpEmis na chave
  });

  it('QR off-line v3 traz os campos do XML e a assinatura RSA-SHA1 verifica com o certificado do emitente', () => {
    const campos = camposDoQR(xml);
    expect(campos).toHaveLength(8);
    expect(campos[0]).toBe(chaveAcesso);
    expect(campos[1]).toBe('3');  // versão do QR (NT 2025.001)
    expect(campos[2]).toBe('2');  // homologação
    expect(campos[3]).toBe(xml.match(/<dhEmi>(\d{4})-(\d{2})-(\d{2})T/)![3]); // dia do dhEmi real
    expect(campos[4]).toBe('100.10'); // vNF do ICMSTot
    expect(campos[5]).toBe('');   // sem consumidor identificado
    expect(campos[6]).toBe('');

    expect(verificaAssinatura(campos, pfxTeste().certPem)).toBe(true);
    // não é o hash CSC do v2 nem contém o token do CSC
    expect(campos[7]).not.toMatch(/^[0-9A-F]{40}$/);
    expect(xml).not.toContain(CSC.token);
  });

  it('continua compatível com wrapEnviNFe (regex <NFe ...</NFe> preserva o supl)', () => {
    // Mesma extração feita por wrapEnviNFe antes de envelopar no enviNFe.
    const nfeMatch = xml.match(/<NFe\s[^]*<\/NFe>/);
    expect(nfeMatch).not.toBeNull();
    expect(nfeMatch![0]).toContain('<infNFeSupl>');
    expect(nfeMatch![0]).toContain('</infNFeSupl>');
    expect(nfeMatch![0]).not.toContain('<?xml');
  });
});
