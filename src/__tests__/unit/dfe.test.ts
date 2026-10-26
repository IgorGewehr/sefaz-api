/**
 * DF-e do destinatário: a distribuição (NFeDistribuicaoDFe) e a Manifestação do
 * Destinatário, no Ambiente Nacional. O SOAP é simulado; o docZip é gzip de
 * verdade e a assinatura da manifestação é real (PFX de teste) e conferida.
 *
 * O que não pode quebrar: uma resposta ruim nunca devolve um ultNSU que o
 * cliente possa gravar (zerar o NSU = baixar tudo de novo e tomar 656).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as zlib from 'zlib';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import type { CertificateData } from '../../types';

const enviarSoap = vi.fn();
vi.mock('../../lib/sefaz/soap-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/sefaz/soap-client')>();
  return { ...original, enviarSoap: (...args: unknown[]) => enviarSoap(...args) };
});

import {
  codigoUf,
  consultarDistribuicao,
  consultarPorChave,
  interpretarDistribuicao,
  manifestar,
  nsu15,
} from '../../services/dfe.service';

const NS = 'http://www.portalfiscal.inf.br/nfe';
const CNPJ = '12345678000195';
const CHAVE = '43260611222333000181550010000001231000000010';
const PFX_PASSWORD = 'senha-teste';

let pfx: { certificado: CertificateData; certPem: string } | undefined;
function pfxTeste(): { certificado: CertificateData; certPem: string } {
  if (pfx) return pfx;
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const attrs = [{ name: 'commonName', value: `EMPRESA TESTE:${CNPJ}` }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], PFX_PASSWORD, { algorithm: '3des' });
  const der = forge.asn1.toDer(p12).getBytes();
  pfx = {
    certificado: { pfxBase64: Buffer.from(der, 'binary').toString('base64'), password: PFX_PASSWORD },
    certPem: forge.pki.certificateToPem(cert),
  };
  return pfx;
}

function docZip(nsu: string, schema: string, xml: string): string {
  const b64 = zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
  return `<docZip NSU="${nsu}" schema="${schema}">${b64}</docZip>`;
}

function soap(ret: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
    `<nfeDistDFeInteresseResult>${ret}</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse>` +
    `</soap:Body></soap:Envelope>`
  );
}

function retDist(cStat: string, xMotivo: string, ult: string, max: string, docs = ''): string {
  return (
    `<retDistDFeInt xmlns="${NS}" versao="1.01"><tpAmb>2</tpAmb><verAplic>1.7.6</verAplic>` +
    `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><dhResp>2026-10-26T10:00:00-03:00</dhResp>` +
    (ult ? `<ultNSU>${ult}</ultNSU>` : '') +
    (max ? `<maxNSU>${max}</maxNSU>` : '') +
    (docs ? `<loteDistDFeInt>${docs}</loteDistDFeInt>` : '') +
    `</retDistDFeInt>`
  );
}

const RES_NFE =
  `<resNFe xmlns="${NS}" versao="1.01"><chNFe>${CHAVE}</chNFe><CNPJ>11222333000181</CNPJ>` +
  `<xNome>FORNECEDOR LTDA</xNome><IE>0960000000</IE><dhEmi>2026-10-25T09:00:00-03:00</dhEmi>` +
  `<tpNF>1</tpNF><vNF>150.00</vNF><digVal>abc=</digVal><dhRecbto>2026-10-25T09:00:05-03:00</dhRecbto>` +
  `<nProt>143260000000001</nProt><cSitNFe>1</cSitNFe></resNFe>`;
const PROC_NFE =
  `<nfeProc xmlns="${NS}" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00"><ide><nNF>123</nNF></ide>` +
  `</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const RES_EVENTO =
  `<resEvento xmlns="${NS}" versao="1.01"><cOrgao>43</cOrgao><CNPJ>11222333000181</CNPJ>` +
  `<chNFe>${CHAVE}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento></resEvento>`;

beforeEach(() => {
  enviarSoap.mockReset();
});

describe('interpretarDistribuicao', () => {
  it('descompacta cada docZip e diz o tipo, o NSU e a chave', () => {
    const r = interpretarDistribuicao(
      soap(
        retDist(
          '138',
          'Documento(s) localizado(s)',
          '000000000000012',
          '000000000000020',
          docZip('000000000000010', 'resNFe_v1.01.xsd', RES_NFE) +
            docZip('000000000000011', 'procNFe_v4.00.xsd', PROC_NFE) +
            docZip('000000000000012', 'resEvento_v1.01.xsd', RES_EVENTO),
        ),
      ),
    );
    expect(r.success).toBe(true);
    expect(r.status).toBe('ok');
    expect(r.ultNSU).toBe('000000000000012');
    expect(r.maxNSU).toBe('000000000000020');
    expect(r.dataResposta).toBe('2026-10-26T10:00:00-03:00');
    expect(r.documentos.map((d) => [d.nsu, d.tipo, d.chaveAcesso])).toEqual([
      ['000000000000010', 'resNFe', CHAVE],
      ['000000000000011', 'procNFe', CHAVE],
      ['000000000000012', 'resEvento', CHAVE],
    ]);
    expect(r.documentos[1].xml).toBe(PROC_NFE);
  });

  it('137 (nenhum documento) é ok, com o NSU para continuar', () => {
    const r = interpretarDistribuicao(soap(retDist('137', 'Nenhum documento localizado', '000000000000020', '000000000000020')));
    expect(r.status).toBe('ok');
    expect(r.documentos).toEqual([]);
    expect(r.ultNSU).toBe('000000000000020');
  });

  it('656 é consumo indevido: esperar 1 hora', () => {
    const r = interpretarDistribuicao(soap(retDist('656', 'Rejeicao: Consumo Indevido', '000000000000020', '000000000000020')));
    expect(r.success).toBe(false);
    expect(r.status).toBe('consumo_indevido');
  });

  it('resposta sem cStat (HTML de erro) ou 138 sem ultNSU nunca devolve NSU', () => {
    const html = interpretarDistribuicao('<html><body>Service Unavailable</body></html>');
    expect(html.status).toBe('erro');
    expect(html.ultNSU).toBe('');
    const semNsu = interpretarDistribuicao(soap(retDist('138', 'Documento(s) localizado(s)', '', '')));
    expect(semNsu.status).toBe('erro');
    expect(semNsu.ultNSU).toBe('');
  });

  it('a consulta por chave não exige NSU', () => {
    const r = interpretarDistribuicao(
      soap(retDist('138', 'Documento localizado', '', '', docZip('000000000000011', 'procNFe_v4.00.xsd', PROC_NFE))),
      false,
    );
    expect(r.status).toBe('ok');
    expect(r.documentos[0].tipo).toBe('procNFe');
  });

  it('rejeição da SEFAZ (ex.: 593, CNPJ do certificado diferente) vem como rejeitado', () => {
    const r = interpretarDistribuicao(soap(retDist('593', 'Rejeicao: CNPJ-Base consultado difere do CNPJ-Base do Certificado', '', '')));
    expect(r.status).toBe('rejeitado');
    expect(r.erros).toEqual(['Rejeicao: CNPJ-Base consultado difere do CNPJ-Base do Certificado']);
  });

  it('docZip ilegível vira erro listado, sem perder os outros', () => {
    const r = interpretarDistribuicao(
      soap(
        retDist(
          '138',
          'Documento(s) localizado(s)',
          '000000000000011',
          '000000000000011',
          `<docZip NSU="000000000000010" schema="resNFe_v1.01.xsd">nao-e-gzip</docZip>` +
            docZip('000000000000011', 'procNFe_v4.00.xsd', PROC_NFE),
        ),
      ),
    );
    expect(r.status).toBe('ok');
    expect(r.documentos).toHaveLength(1);
    expect(r.erros?.[0]).toContain('NSU 000000000000010');
  });
});

describe('pedidos à SEFAZ', () => {
  it('nsu15 e codigoUf', () => {
    expect(nsu15(undefined)).toBe('000000000000000');
    expect(nsu15(42)).toBe('000000000000042');
    expect(() => nsu15('1234567890123456')).toThrow();
    expect(codigoUf('rs')).toBe('43');
    expect(codigoUf('43')).toBe('43');
    expect(() => codigoUf('XX')).toThrow();
  });

  it('distribuição: distNSU no Ambiente Nacional, com o NSU em 15 dígitos', async () => {
    enviarSoap.mockResolvedValueOnce(soap(retDist('137', 'Nenhum documento localizado', '000000000000042', '000000000000042')));
    const r = await consultarDistribuicao({
      cnpj: '12.345.678/0001-95',
      ufAutor: 'RS',
      ultNSU: 42,
      certificado: pfxTeste().certificado,
      ambiente: 'homologacao',
    });
    expect(r.status).toBe('ok');
    const [url, acao, corpo] = enviarSoap.mock.calls[0];
    expect(url).toBe('https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
    expect(acao).toBe('http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse');
    expect(corpo).toContain('<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>');
    expect(corpo).toContain(
      `<distDFeInt xmlns="${NS}" versao="1.01"><tpAmb>2</tpAmb><cUFAutor>43</cUFAutor>` +
        `<CNPJ>${CNPJ}</CNPJ><distNSU><ultNSU>000000000000042</ultNSU></distNSU></distDFeInt>`,
    );
  });

  it('consulta por chave: consChNFe, em produção no www1', async () => {
    enviarSoap.mockResolvedValueOnce(
      soap(retDist('138', 'Documento localizado', '', '', docZip('000000000000011', 'procNFe_v4.00.xsd', PROC_NFE))),
    );
    const r = await consultarPorChave({
      cnpj: CNPJ,
      ufAutor: '43',
      chaveAcesso: CHAVE,
      certificado: pfxTeste().certificado,
      ambiente: 'producao',
    });
    expect(r.documentos[0].xml).toBe(PROC_NFE);
    const [url, , corpo] = enviarSoap.mock.calls[0];
    expect(url).toBe('https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx');
    expect(corpo).toContain(`<tpAmb>1</tpAmb>`);
    expect(corpo).toContain(`<consChNFe><chNFe>${CHAVE}</chNFe></consChNFe>`);
  });

  it('falha de comunicação vira erro, sem NSU', async () => {
    enviarSoap.mockRejectedValueOnce(new Error('socket hang up'));
    const r = await consultarDistribuicao({ cnpj: CNPJ, ufAutor: 'RS', certificado: pfxTeste().certificado });
    expect(r.status).toBe('erro');
    expect(r.ultNSU).toBe('');
    expect(r.motivoStatus).toContain('socket hang up');
  });
});

describe('manifestação do destinatário', () => {
  function respostaDoEvento(cStat: string, tpEvento: string): string {
    return (
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
      `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
      `<retEnvEvento xmlns="${NS}" versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>AN_1.0</verAplic>` +
      `<cOrgao>91</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
      `<retEvento versao="1.00"><infEvento Id="ID891260000000001"><tpAmb>2</tpAmb><verAplic>AN_1.0</verAplic>` +
      `<cOrgao>91</cOrgao><cStat>${cStat}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>` +
      `<chNFe>${CHAVE}</chNFe><tpEvento>${tpEvento}</tpEvento><nSeqEvento>1</nSeqEvento>` +
      `<dhRegEvento>2026-10-26T10:01:00-03:00</dhRegEvento><nProt>891260000000001</nProt></infEvento></retEvento>` +
      `</retEnvEvento></nfeResultMsg></soap:Body></soap:Envelope>`
    );
  }

  it('ciência: evento 210210 no Ambiente Nacional, assinado, e o procEventoNFe de volta', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDoEvento('135', '210210'));
    const r = await manifestar({
      cnpj: CNPJ,
      chaveAcesso: CHAVE,
      tipo: 'ciencia',
      certificado: pfxTeste().certificado,
      ambiente: 'homologacao',
    });
    expect(r.success).toBe(true);
    expect(r.protocolo).toBe('891260000000001');
    const [url, acao, corpo] = enviarSoap.mock.calls[0];
    expect(url).toBe('https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx');
    expect(acao).toBe('http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEventoNF');
    expect(corpo).toContain('<cOrgao>91</cOrgao>');
    expect(corpo).toContain(`<evento xmlns="${NS}" versao="1.00"><infEvento Id="ID210210${CHAVE}01">`);
    expect(corpo).toContain('<descEvento>Ciencia da Operacao</descEvento>');
    expect(corpo).not.toContain('<xJust>');

    const xml = r.xml!;
    expect(xml.startsWith(`<procEventoNFe versao="1.00" xmlns="${NS}">`)).toBe(true);
    const assinatura = xml.match(/<Signature[\s\S]*?<\/Signature>/)![0];
    const sig = new SignedXml({ publicCert: pfxTeste().certPem });
    sig.loadSignature(assinatura);
    expect(sig.checkSignature(xml)).toBe(true);
  });

  it('operação não realizada leva a justificativa', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDoEvento('135', '210240'));
    await manifestar({
      cnpj: CNPJ,
      chaveAcesso: CHAVE,
      tipo: 'nao_realizada',
      justificativa: 'Mercadoria devolvida sem entrada',
      certificado: pfxTeste().certificado,
    });
    const corpo = enviarSoap.mock.calls[0][2] as string;
    expect(corpo).toContain('<tpEvento>210240</tpEvento>');
    expect(corpo).toContain('<xJust>Mercadoria devolvida sem entrada</xJust>');
  });

  it('já manifestado (573) volta sem sucesso, com o código', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDoEvento('573', '210210'));
    const r = await manifestar({ cnpj: CNPJ, chaveAcesso: CHAVE, tipo: 'ciencia', certificado: pfxTeste().certificado });
    expect(r.success).toBe(false);
    expect(r.codigoStatus).toBe('573');
    expect(r.xml).toBeUndefined();
  });
});
