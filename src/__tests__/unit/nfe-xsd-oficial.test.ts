/**
 * A NF-e e a NFC-e (normal e em contingência off-line) montadas e assinadas pelo `sefaz-api`,
 * contra o XSD oficial da NF-e 4.00 (PL_009_V4). Os pedidos têm o formato que o gestao-raiz e o
 * Cardeal mandam. Usa o xmllint; sem ele, os testes são pulados com aviso.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as forge from 'node-forge';
import { buildNFeXml, buildNFCeXml, buildNFCeSupl } from '../../lib/nfe/xml-builder';
import { assinarXml } from '../../lib/sefaz/xml-signer';
import { montarChaveAcesso } from '../../lib/utils';
import { prepararNFCeContingencia } from '../../services/nfe.service';
import type { CertificateData } from '../../types';

const temXmllint = spawnSync('xmllint', ['--version']).status === 0;
const XSD = path.join(__dirname, '..', 'fixtures', 'nfe-xsd', 'nfe_v4.00.xsd');
const CNPJ = '42885112000117';

let cert: CertificateData | undefined;
function certificado(): CertificateData {
  if (cert) return cert;
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = keys.publicKey;
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: 'commonName', value: `EMPRESA TESTE:${CNPJ}` }, { name: 'countryName', value: 'BR' }];
  c.setSubject(attrs);
  c.setIssuer(attrs);
  c.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [c], 'senha', { algorithm: '3des' });
  cert = { pfxBase64: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64'), password: 'senha' };
  return cert;
}

function validar(xml: string): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-xsd-'));
  try {
    const arquivo = path.join(dir, 'nfe.xml');
    fs.writeFileSync(arquivo, xml);
    execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, arquivo], { stdio: 'pipe' });
    return null;
  } catch (e: any) {
    return String(e.stderr || e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function chave(modelo: '55' | '65', numero: number, tpEmis = '1'): string {
  return montarChaveAcesso({
    cUF: '42', dataEmissao: new Date(), cnpj: CNPJ, modelo, serie: '1', numero,
    tipoEmissao: tpEmis, codigoNumerico: '12345678', uf: 'SC',
  });
}

const endereco = {
  logradouro: 'Rua das Flores', numero: '100', bairro: 'Centro', codigoMunicipio: '4205407',
  municipio: 'Florianopolis', uf: 'SC', cep: '88010000',
};
const emitente = (crt: '1' | '3' = '1') => ({
  cnpj: CNPJ, nome: 'EMPRESA TESTE LTDA', nomeFantasia: 'TESTE', inscricaoEstadual: '261234567', crt,
  endereco: { ...endereco, telefone: '4833334444' },
});
const item = (n: number, pisCofins: string, extra: Record<string, any> = {}) => ({
  numero: n,
  produto: {
    codigo: `P${n}`, cEAN: 'SEM GTIN', descricao: `Produto ${n}`, ncm: '34011190', cfop: '5102', unidade: 'UN',
    quantidade: 2, valorUnitario: 12.5, valorTotal: 25, cEANTrib: 'SEM GTIN', unidadeTrib: 'UN',
    quantidadeTrib: 2, valorUnitarioTrib: 12.5, indTot: '1', ...(extra.produto ?? {}),
  },
  imposto: { icms: { orig: '0', csosn: '102' }, pis: { cst: pisCofins }, cofins: { cst: pisCofins }, ...(extra.imposto ?? {}) },
});
const nfe = (over: Record<string, any> = {}): any => ({
  numero: 105, serie: '1', ufEmitente: 'SC', ambiente: 'homologacao', naturezaOperacao: 'Venda de mercadoria',
  tipoOperacao: '1', finalidade: '1', consumidorFinal: '1', presencaComprador: '1', emitente: emitente(),
  destinatario: {
    cnpj: '11222333000181', nome: 'CLIENTE LTDA', inscricaoEstadual: '254999888', indicadorIE: '1',
    endereco: { ...endereco, codigoMunicipio: '4209102', municipio: 'Joinville', cep: '89201000' },
  },
  itens: [item(1, '07'), item(2, '49', { produto: { valorDesconto: 2 } })],
  transporte: { modFrete: '9' },
  pagamento: { indicadorPagamento: '0', formas: [{ tipo: '15', valor: 48 }] },
  cobranca: { fatura: { numero: '105', valorOriginal: 48, valorLiquido: 48 }, duplicatas: [{ numero: '001', vencimento: '2026-12-23', valor: 48 }] },
  certificado: certificado(), ...over,
});
const nfce = (over: Record<string, any> = {}): any => ({
  numero: 326, serie: '1', ufEmitente: 'SC', ambiente: 'homologacao', naturezaOperacao: 'Venda a consumidor',
  tipoOperacao: '1', finalidade: '1', consumidorFinal: '1', presencaComprador: '1', emitente: emitente(),
  consumidor: { cpf: '52998224725', nome: 'Maria' },
  itens: [item(1, '07')], transporte: { modFrete: '9' },
  pagamento: { indicadorPagamento: '0', formas: [{ tipo: '01', valor: 30 }], troco: 5 },
  csc: { id: '1', token: 'ABCDEF0123456789' }, certificado: certificado(), ...over,
});

function nfeAssinada(req: any): string {
  const ch = chave('55', req.numero);
  return assinarXml(buildNFeXml(req, ch, req.numero, '2'), req.certificado, 'infNFe');
}

describe.skipIf(!temXmllint)('NF-e/NFC-e contra o XSD oficial 4.00', () => {
  it('NF-e do Simples (PIS/COFINS 07 e 49 sem valores) com duplicata', () => {
    expect(validar(nfeAssinada(nfe()))).toBeNull();
  });

  it('NF-e do regime normal (CST 00, PIS/COFINS 01) com pagamento 99', () => {
    const req = nfe({
      emitente: emitente('3'), cobranca: undefined,
      itens: [item(1, '01', { imposto: {
        icms: { orig: '0', cst: '00', modBC: '3', valorBC: 25, aliquota: 17, valor: 4.25 },
        pis: { cst: '01', valorBC: 25, aliquota: 1.65, valor: 0.41 },
        cofins: { cst: '01', valorBC: 25, aliquota: 7.6, valor: 1.9 },
      } })],
      pagamento: { indicadorPagamento: '0', formas: [{ tipo: '99', valor: 25 }] },
    });
    expect(validar(nfeAssinada(req))).toBeNull();
  });

  it('NF-e de devolução: o NFref é o último grupo do <ide>', () => {
    const req = nfe({
      finalidade: '4', cobranca: undefined,
      referencias: [{ refNFe: '42261142885112000117550010000001051374428248' }],
      pagamento: { indicadorPagamento: '0', formas: [{ tipo: '90', valor: 0 }] },
    });
    const xml = nfeAssinada(req);
    expect(xml).toMatch(/<verProc>[^<]*<\/verProc><NFref><refNFe>\d{44}<\/refNFe><\/NFref><\/ide>/);
    expect(validar(xml)).toBeNull();
  });

  it('NFC-e normal com o QR Code v3', () => {
    const req = nfce();
    const ch = chave('65', req.numero);
    const assinada = assinarXml(buildNFCeXml(req, ch, req.numero, '2'), req.certificado, 'infNFe');
    const xml = assinada.replace('<Signature', `${buildNFCeSupl(ch, '2', req.csc, 'SC')}<Signature`);
    expect(validar(xml)).toBeNull();
  });

  it('NFC-e em contingência off-line (prepare): tpEmis 9, dhCont/xJust e o QR assinado', async () => {
    const r = await prepararNFCeContingencia(nfce({
      contingencia: { dhCont: '2026-11-23T10:00:00-03:00', xJust: 'SEFAZ indisponivel - sem resposta do autorizador' },
    }));
    expect(r.success, r.motivoStatus).toBe(true);
    expect(r.chaveAcesso!.charAt(34)).toBe('9');
    expect(r.xml).toContain('<tpEmis>9</tpEmis>');
    expect(validar(r.xml!)).toBeNull();
  });

  it('NFC-e em contingência sem consumidor identificado', async () => {
    const r = await prepararNFCeContingencia(nfce({
      consumidor: undefined,
      contingencia: { dhCont: '2026-11-23T10:00:00-03:00', xJust: 'SEFAZ indisponivel - sem resposta do autorizador' },
    }));
    expect(r.success, r.motivoStatus).toBe(true);
    expect(validar(r.xml!)).toBeNull();
  });
});

if (!temXmllint) console.warn('[nfe-xsd-oficial] xmllint ausente — testes contra o XSD pulados');
