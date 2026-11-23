/**
 * Contingência SVC da NF-e (tpEmis 6 = SVC-AN, 7 = SVC-RS): a chave e o <ide> levam o tpEmis da
 * SVC da UF, com dhCont/xJust, a nota vai ao webservice da SVC (o da SVC-AN é o sefazvirtual
 * desde 11/02/2025), passa no XSD oficial, e a consulta de uma nota de SVC tenta a SVC e depois
 * a UF. O SOAP é simulado; a assinatura é real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as forge from 'node-forge';
import type { CertificateData, NFeRequest } from '../../types';

const enviarSoap = vi.fn();
vi.mock('../../lib/sefaz/soap-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/sefaz/soap-client')>();
  return { ...original, enviarSoap: (...args: unknown[]) => enviarSoap(...args) };
});

import { emitirNFe, consultarProtocolo, statusServico, validateNFePayload } from '../../services/nfe.service';
import { getSVCEndpoints, tipoEmissaoSvc, chaveDeSvc } from '../../lib/sefaz/endpoints';
import { SefazNaoAlcancadaError } from '../../lib/sefaz/soap-client';

const NS = 'http://www.portalfiscal.inf.br/nfe';
const CNPJ = '42885112000117';
const temXmllint = spawnSync('xmllint', ['--version']).status === 0;
const XSD = path.join(__dirname, '..', 'fixtures', 'nfe-xsd', 'nfe_v4.00.xsd');

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

const endereco = {
  logradouro: 'Rua das Flores', numero: '100', bairro: 'Centro', codigoMunicipio: '4205407',
  municipio: 'Florianopolis', uf: 'SC', cep: '88010000',
};
const JUST = 'SEFAZ SVRS fora do ar - contingencia SVC-AN ativada';
function nfe(over: Partial<NFeRequest> = {}): NFeRequest {
  return {
    numero: 106, serie: '1', ufEmitente: 'SC', ambiente: 'homologacao', naturezaOperacao: 'Venda de mercadoria',
    tipoOperacao: '1', finalidade: '1', consumidorFinal: '1', presencaComprador: '1',
    emitente: { cnpj: CNPJ, nome: 'EMPRESA TESTE LTDA', inscricaoEstadual: '261234567', crt: '1', endereco },
    destinatario: {
      cnpj: '11222333000181', nome: 'CLIENTE LTDA', inscricaoEstadual: '254999888', indicadorIE: '1',
      endereco: { ...endereco, codigoMunicipio: '4209102', municipio: 'Joinville', cep: '89201000' },
    },
    itens: [{
      numero: 1,
      produto: { codigo: 'P1', cEAN: 'SEM GTIN', descricao: 'Produto', ncm: '34011190', cfop: '5102', unidade: 'UN',
        quantidade: 1, valorUnitario: 10, valorTotal: 10, cEANTrib: 'SEM GTIN', unidadeTrib: 'UN',
        quantidadeTrib: 1, valorUnitarioTrib: 10, indTot: '1' },
      imposto: { icms: { orig: '0', csosn: '102' }, pis: { cst: '07' }, cofins: { cst: '07' } },
    }],
    transporte: { modFrete: '9' },
    pagamento: { indicadorPagamento: '0', formas: [{ tipo: '01', valor: 10 }] },
    certificado: certificado(),
    contingencia: { dhCont: new Date(Date.now() - 600_000).toISOString(), xJust: JUST },
    ...over,
  } as NFeRequest;
}

function soap(resultado: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/x">${resultado}</nfeResultMsg>` +
    `</soap:Body></soap:Envelope>`
  );
}
function prot(chave: string, cStat = '100'): string {
  return (
    `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVC</verAplic><chNFe>${chave}</chNFe>` +
    `<dhRecbto>2026-11-23T10:00:00-03:00</dhRecbto><nProt>342260000000001</nProt><digVal>x</digVal>` +
    `<cStat>${cStat}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`
  );
}
function retEnvi(chave: string): string {
  return soap(
    `<retEnviNFe xmlns="${NS}" versao="4.00"><tpAmb>2</tpAmb><verAplic>SVC</verAplic><cStat>104</cStat>` +
    `<xMotivo>Lote processado</xMotivo><cUF>42</cUF><dhRecbto>2026-11-23T10:00:00-03:00</dhRecbto>${prot(chave)}</retEnviNFe>`,
  );
}
function retCons(chave: string, cStat: string, comProt: boolean): string {
  return soap(
    `<retConsSitNFe xmlns="${NS}" versao="4.00"><tpAmb>2</tpAmb><verAplic>X</verAplic><cStat>${cStat}</cStat>` +
    `<xMotivo>m</xMotivo><cUF>42</cUF><chNFe>${chave}</chNFe>${comProt ? prot(chave) : ''}</retConsSitNFe>`,
  );
}

function validar(xml: string): string | null {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfe-svc-'));
  try {
    const f = path.join(dir, 'nfe.xml');
    fs.writeFileSync(f, xml);
    execFileSync('xmllint', ['--noout', '--nonet', '--schema', XSD, f], { stdio: 'pipe' });
    return null;
  } catch (e: any) {
    return String(e.stderr || e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => enviarSoap.mockReset());

describe('SVC: mapa e endereços', () => {
  it('SC vai à SVC-AN (6), PR à SVC-RS (7)', () => {
    expect(tipoEmissaoSvc('SC')).toBe('6');
    expect(tipoEmissaoSvc('PR')).toBe('7');
  });
  it('a SVC-AN atende no sefazvirtual (os svc.fazenda.gov.br foram desligados)', () => {
    expect(getSVCEndpoints('SC', 'producao').autorizacao)
      .toBe('https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx');
    expect(getSVCEndpoints('SC', 'homologacao').autorizacao)
      .toBe('https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx');
  });
});

describe('SVC: validação', () => {
  it('sem justificativa de 15+ caracteres ou sem dhCont é recusada antes de assinar', () => {
    expect(validateNFePayload(nfe({ contingencia: { dhCont: new Date().toISOString(), xJust: 'curta' } })))
      .toContain('contingencia.xJust (justificativa) deve ter de 15 a 256 caracteres');
    expect(validateNFePayload(nfe({ contingencia: { dhCont: 'ontem', xJust: JUST } })).join())
      .toContain('contingencia.dhCont');
    expect(validateNFePayload(nfe({ contingencia: { dhCont: new Date(Date.now() + 3_600_000).toISOString(), xJust: JUST } })))
      .toContain('contingencia.dhCont não pode estar no futuro');
  });
});

describe('SVC: emissão', () => {
  it('a chave e o <ide> levam tpEmis 6, com dhCont/xJust no fuso da UF, e vai à SVC-AN', async () => {
    enviarSoap.mockImplementationOnce(async (_url: string, _a: string, corpo: string) => {
      const chave = corpo.match(/Id="NFe(\d{44})"/)![1];
      return retEnvi(chave);
    });
    const r = await emitirNFe(nfe());
    expect(r.success, r.motivoStatus).toBe(true);
    expect(enviarSoap.mock.calls[0][0]).toBe(getSVCEndpoints('SC', 'homologacao').autorizacao);
    expect(r.chaveAcesso!.charAt(34)).toBe('6');
    expect(chaveDeSvc(r.chaveAcesso!)).toBe(true);
    const corpo: string = enviarSoap.mock.calls[0][2];
    expect(corpo).toContain('<tpEmis>6</tpEmis>');
    expect(corpo).toMatch(/<dhCont>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00<\/dhCont><xJust>SEFAZ SVRS fora/);
    expect(r.xml).toContain('<nfeProc');
  });

  it.skipIf(!temXmllint)('a NF-e de SVC passa no XSD oficial', async () => {
    enviarSoap.mockImplementationOnce(async (_u: string, _a: string, corpo: string) =>
      retEnvi(corpo.match(/Id="NFe(\d{44})"/)![1]));
    await emitirNFe(nfe());
    const corpo: string = enviarSoap.mock.calls[0][2];
    const nfeXml = corpo.match(/<NFe xmlns[\s\S]*<\/NFe>/)![0];
    expect(validar(nfeXml)).toBeNull();
  });

  it('sem contingência, nada muda: tpEmis 1 e o webservice da UF', async () => {
    enviarSoap.mockImplementationOnce(async (_u: string, _a: string, corpo: string) =>
      retEnvi(corpo.match(/Id="NFe(\d{44})"/)![1]));
    const r = await emitirNFe(nfe({ contingencia: undefined }));
    expect(r.chaveAcesso!.charAt(34)).toBe('1');
    expect(enviarSoap.mock.calls[0][0]).toContain('svrs.rs.gov.br');
    expect(enviarSoap.mock.calls[0][2]).not.toContain('<dhCont>');
  });

  it('a SVC fora também volta como não enviada', async () => {
    enviarSoap.mockRejectedValueOnce(new SefazNaoAlcancadaError('ECONNREFUSED'));
    const r = await emitirNFe(nfe());
    expect(r.naoEnviado).toBe(true);
  });
});

describe('SVC: consulta', () => {
  const CHAVE_SVC = '42261142885112000117550010000001066123456785';
  const base = { chaveAcesso: CHAVE_SVC, certificado: certificado(), ambiente: 'homologacao' as const, ufEmitente: 'SC' };

  it('a nota de SVC é consultada primeiro na SVC', async () => {
    enviarSoap.mockResolvedValueOnce(retCons(CHAVE_SVC, '100', true));
    const r = await consultarProtocolo(base);
    expect(r.success).toBe(true);
    expect(enviarSoap).toHaveBeenCalledTimes(1);
    expect(enviarSoap.mock.calls[0][0]).toBe(getSVCEndpoints('SC', 'homologacao').consultaProtocolo);
  });

  it('sem a nota na SVC (ou sem a SVC), a autorizadora da UF', async () => {
    enviarSoap
      .mockRejectedValueOnce(new SefazNaoAlcancadaError('SVC desativada'))
      .mockResolvedValueOnce(retCons(CHAVE_SVC, '100', true));
    const r = await consultarProtocolo(base);
    expect(r.success).toBe(true);
    expect(enviarSoap.mock.calls[1][0]).toContain('svrs.rs.gov.br');
  });

  it('não consta em nenhuma: o 217 da SVC volta', async () => {
    enviarSoap
      .mockResolvedValueOnce(retCons(CHAVE_SVC, '217', false))
      .mockResolvedValueOnce(retCons(CHAVE_SVC, '217', false));
    const r = await consultarProtocolo(base);
    expect(r.codigoStatus).toBe('217');
  });

  it('a nota normal não passa pela SVC', async () => {
    const normal = CHAVE_SVC.substring(0, 34) + '1' + CHAVE_SVC.substring(35);
    enviarSoap.mockResolvedValueOnce(retCons(normal, '100', true));
    await consultarProtocolo({ ...base, chaveAcesso: normal });
    expect(enviarSoap).toHaveBeenCalledTimes(1);
    expect(enviarSoap.mock.calls[0][0]).toContain('svrs.rs.gov.br');
  });
});

describe('SVC: status', () => {
  it('svc: true consulta o status da SVC da UF', async () => {
    enviarSoap.mockResolvedValueOnce(soap(`<retConsStatServ xmlns="${NS}" versao="4.00"><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo></retConsStatServ>`));
    const r = await statusServico({ certificado: certificado(), ambiente: 'homologacao', ufEmitente: 'SC', svc: true });
    expect(r.success).toBe(true);
    expect(enviarSoap.mock.calls[0][0]).toBe(getSVCEndpoints('SC', 'homologacao').statusServico);
  });
});
