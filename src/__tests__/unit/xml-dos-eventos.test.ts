/**
 * O XML que o emissor tem de guardar por 5 anos, além do nfeProc:
 * - procEventoNFe do cancelamento e da CC-e (evento assinado + retEvento literal);
 * - procInutNFe da inutilização (pedido assinado + retInutNFe literal);
 * - na consulta de nota cancelada, o status `cancelado` (antes voltava `autorizado`,
 *   pelo cStat 100 do protNFe da autorização) e o procEventoNFe do cancelamento;
 * - na emissão incerta, o XML assinado — e a consulta com ele devolve o nfeProc.
 *
 * O SOAP é simulado; a assinatura é real (PFX de teste) e é conferida DEPOIS de o
 * evento ir para dentro do procEventoNFe/procInutNFe: o envelope não pode quebrá-la.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import type { CertificateData, NFCeRequest } from '../../types';

const enviarSoap = vi.fn();
vi.mock('../../lib/sefaz/soap-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/sefaz/soap-client')>();
  return { ...original, enviarSoap: (...args: unknown[]) => enviarSoap(...args) };
});

import {
  cancelarNFe,
  cartaCorrecao,
  consultarProtocolo,
  emitirNFCe,
  extrairProcCancelamento,
  inutilizar,
  montarProcEventoNFe,
  montarProcInutNFe,
  nfeProcDaConsulta,
} from '../../services/nfe.service';

const NS = 'http://www.portalfiscal.inf.br/nfe';
const CNPJ = '12345678000195';
const CHAVE = '35260612345678000195650010000001231000000010';
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

/** A assinatura do documento confere com o certificado (como faria a SEFAZ ou o contador). */
function assinaturaConfere(xml: string): boolean {
  const assinatura = xml.match(/<Signature[\s\S]*?<\/Signature>/);
  expect(assinatura, 'o documento deve trazer a assinatura').not.toBeNull();
  const sig = new SignedXml({ publicCert: pfxTeste().certPem });
  sig.loadSignature(assinatura![0]);
  return sig.checkSignature(xml);
}

function soap(resultado: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/x">${resultado}</nfeResultMsg>` +
    `</soap:Body></soap:Envelope>`
  );
}

function retEvento(tpEvento: string, cStat: string, nProt: string): string {
  return (
    `<retEvento versao="1.00"><infEvento Id="ID${nProt}">` +
    `<tpAmb>2</tpAmb><verAplic>SP_EVENTOS_PL_100</verAplic><cOrgao>35</cOrgao>` +
    `<cStat>${cStat}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>` +
    `<chNFe>${CHAVE}</chNFe><tpEvento>${tpEvento}</tpEvento><nSeqEvento>1</nSeqEvento>` +
    `<dhRegEvento>2026-06-11T10:05:00-03:00</dhRegEvento><nProt>${nProt}</nProt>` +
    `</infEvento></retEvento>`
  );
}

function respostaDoEvento(cStat: string, tpEvento = '110111'): string {
  return soap(
    `<retEnvEvento xmlns="${NS}" versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb>` +
      `<verAplic>SP_EVENTOS_PL_100</verAplic><cOrgao>35</cOrgao><cStat>128</cStat>` +
      `<xMotivo>Lote de Evento Processado</xMotivo>${retEvento(tpEvento, cStat, '135260000000777')}</retEnvEvento>`,
  );
}

beforeEach(() => {
  enviarSoap.mockReset();
});

describe('cancelamento e CC-e devolvem o procEventoNFe', () => {
  it('cancelamento registrado: evento assinado + retEvento literal, e a assinatura confere', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDoEvento('135'));
    const r = await cancelarNFe({
      chaveAcesso: CHAVE,
      protocolo: '135260000000001',
      justificativa: 'Venda desfeita a pedido do cliente',
      certificado: pfxTeste().certificado,
      ambiente: 'homologacao',
      ufEmitente: 'SP',
    });

    expect(r.success).toBe(true);
    expect(r.protocolo).toBe('135260000000777');
    const xml = r.xml!;
    expect(xml.startsWith(`<procEventoNFe versao="1.00" xmlns="${NS}">`)).toBe(true);
    expect(xml.endsWith('</procEventoNFe>')).toBe(true);
    expect(xml).not.toContain('<?xml');
    expect(xml).not.toContain('envEvento');
    expect(xml).toContain('<descEvento>Cancelamento</descEvento>');
    expect(xml).toContain('<verAplic>SP_EVENTOS_PL_100</verAplic>');
    expect(xml.indexOf('</evento>')).toBeLessThan(xml.indexOf('<retEvento'));
    expect(assinaturaConfere(xml)).toBe(true);
    // A conferência não é de fachada: mexer no evento quebra a assinatura.
    expect(assinaturaConfere(xml.replace('Venda desfeita', 'Venda alterada'))).toBe(false);
  });

  it('cancelamento fora de prazo (155) também volta com o XML', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDoEvento('155'));
    const r = await cancelarNFe({
      chaveAcesso: CHAVE,
      protocolo: '135260000000001',
      justificativa: 'Venda desfeita a pedido do cliente',
      certificado: pfxTeste().certificado,
      ufEmitente: 'SP',
    });
    expect(r.success).toBe(true);
    expect(r.xml).toContain('<cStat>155</cStat>');
  });

  it('cancelamento recusado (573) não traz XML', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDoEvento('573'));
    const r = await cancelarNFe({
      chaveAcesso: CHAVE,
      protocolo: '135260000000001',
      justificativa: 'Venda desfeita a pedido do cliente',
      certificado: pfxTeste().certificado,
      ufEmitente: 'SP',
    });
    expect(r.success).toBe(false);
    expect(r.xml).toBeUndefined();
  });

  it('CC-e registrada devolve o procEventoNFe dela', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDoEvento('135', '110110'));
    const r = await cartaCorrecao({
      chaveAcesso: CHAVE,
      correcao: 'Corrige o endereco de entrega para Rua B, 20',
      certificado: pfxTeste().certificado,
      ufEmitente: 'SP',
    });
    expect(r.success).toBe(true);
    expect(r.xml).toContain('<descEvento>Carta de Correcao</descEvento>');
    expect(assinaturaConfere(r.xml!)).toBe(true);
  });

  it('montarProcEventoNFe sem retEvento na resposta devolve undefined', () => {
    expect(montarProcEventoNFe('<envEvento><evento versao="1.00"></evento></envEvento>', soap('<x/>'))).toBeUndefined();
  });
});

describe('inutilização devolve o procInutNFe', () => {
  function respostaDaInutilizacao(cStat: string): string {
    return soap(
      `<retInutNFe xmlns="${NS}" versao="4.00"><infInut Id="ID135260000000888">` +
        `<tpAmb>2</tpAmb><verAplic>SP_NFCE_PL_009</verAplic><cStat>${cStat}</cStat>` +
        `<xMotivo>Inutilizacao de numero homologado</xMotivo><cUF>35</cUF><ano>26</ano>` +
        `<CNPJ>${CNPJ}</CNPJ><mod>65</mod><serie>1</serie><nNFIni>7</nNFIni><nNFFin>7</nNFFin>` +
        `<dhRecbto>2026-06-11T10:06:00-03:00</dhRecbto><nProt>135260000000888</nProt>` +
        `</infInut></retInutNFe>`,
    );
  }

  const pedido = () => ({
    cnpj: CNPJ,
    serie: '1',
    numeroInicial: 7,
    numeroFinal: 7,
    justificativa: 'Numero pulado por falha do sistema',
    modelo: '65' as const,
    ano: '26',
    certificado: pfxTeste().certificado,
    ambiente: 'homologacao' as const,
    ufEmitente: 'SP',
  });

  it('homologada (102): pedido assinado + retInutNFe literal, e a assinatura confere', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDaInutilizacao('102'));
    const r = await inutilizar(pedido());

    expect(r.success).toBe(true);
    expect(r.protocolo).toBe('135260000000888');
    const xml = r.xml!;
    expect(xml.startsWith(`<procInutNFe versao="4.00" xmlns="${NS}">`)).toBe(true);
    expect(xml).not.toContain('<?xml');
    expect(xml).toContain('<xServ>INUTILIZAR</xServ>');
    expect(xml).toContain('<verAplic>SP_NFCE_PL_009</verAplic>');
    expect(xml.indexOf('</inutNFe>')).toBeLessThan(xml.indexOf('<retInutNFe'));
    expect(assinaturaConfere(xml)).toBe(true);
  });

  it('recusada não traz XML', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDaInutilizacao('563'));
    const r = await inutilizar(pedido());
    expect(r.success).toBe(false);
    expect(r.xml).toBeUndefined();
  });

  it('montarProcInutNFe sem retInutNFe devolve undefined', () => {
    expect(montarProcInutNFe('<inutNFe></inutNFe>', soap('<x/>'))).toBeUndefined();
  });
});

describe('emissão incerta e a consulta', () => {
  function nfce(): NFCeRequest {
    return {
      emitente: {
        cnpj: CNPJ,
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
          imposto: { icms: { orig: '0', csosn: '102' }, pis: { cst: '49' }, cofins: { cst: '49' } },
        },
      ],
      pagamento: { indicadorPagamento: '0', formas: [{ tipo: '01', valor: 100.1 }] },
      transporte: { modFrete: '9' },
      csc: { id: '000001', token: 'A1B2C3D4-E5F6-A7B8-C9D0-E1F2A3B4C5D6' },
      certificado: pfxTeste().certificado,
      ambiente: 'homologacao',
      serie: '1',
      numero: 123,
      ufEmitente: 'SP',
    } as NFCeRequest;
  }

  function protNFe(chave: string, cStat: string, digVal: string): string {
    return (
      `<protNFe versao="4.00"><infProt Id="ID135260000000001">` +
      `<tpAmb>2</tpAmb><verAplic>SP_NFCE_PL_009</verAplic><chNFe>${chave}</chNFe>` +
      `<dhRecbto>2026-06-11T10:00:00-03:00</dhRecbto><nProt>135260000000001</nProt>` +
      `<digVal>${digVal}</digVal><cStat>${cStat}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>` +
      `</infProt></protNFe>`
    );
  }

  function respostaDaConsulta(cStat: string, xMotivo: string, prot: string, eventos = ''): string {
    return soap(
      `<retConsSitNFe xmlns="${NS}" versao="4.00"><tpAmb>2</tpAmb><verAplic>SP_NFCE_PL_009</verAplic>` +
        `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>35</cUF><chNFe>${CHAVE}</chNFe>` +
        `${prot}${eventos}</retConsSitNFe>`,
    );
  }

  it('falha de comunicação depois de assinar devolve a chave e o XML assinado', async () => {
    enviarSoap.mockRejectedValueOnce(new Error('socket hang up'));
    const r = await emitirNFCe(nfce());

    expect(r.status).toBe('erro');
    expect(r.chaveAcesso).toMatch(/^\d{44}$/);
    expect(r.xmlAssinado).toContain(`Id="NFe${r.chaveAcesso}"`);
    expect(r.xmlAssinado).toContain('<infNFeSupl>');
    expect(r.xml).toBeUndefined();
  });

  it('rejeição não devolve o XML assinado (o número volta a ser usado)', async () => {
    enviarSoap.mockResolvedValueOnce(
      soap(`<retEnviNFe xmlns="${NS}" versao="4.00"><cStat>225</cStat><xMotivo>Rejeicao: Falha no Schema</xMotivo></retEnviNFe>`),
    );
    const r = await emitirNFCe(nfce());
    expect(r.status).toBe('rejeitado');
    expect(r.xmlAssinado).toBeUndefined();
  });

  it('denegada volta com o nfeProc (a denegação também é guardada)', async () => {
    enviarSoap.mockImplementationOnce(async (_url: string, _acao: string, corpo: string) => {
      const chave = corpo.match(/Id="NFe(\d{44})"/)![1];
      const prot = protNFe(chave, '302', 'x').replace('Autorizado o uso da NF-e', 'Uso Denegado');
      return soap(`<retEnviNFe xmlns="${NS}" versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot}</retEnviNFe>`);
    });
    const r = await emitirNFCe(nfce());
    expect(r.status).toBe('denegado');
    expect(r.xml?.startsWith('<nfeProc')).toBe(true);
    expect(r.xml).toContain('<cStat>302</cStat>');
  });

  it('a consulta com o XML assinado devolve o nfeProc com o protNFe literal', async () => {
    enviarSoap.mockRejectedValueOnce(new Error('timeout'));
    const incerta = await emitirNFCe(nfce());
    const chave = incerta.chaveAcesso!;
    const digest = incerta.xmlAssinado!.match(/<DigestValue>([^<]+)<\/DigestValue>/)![1];

    enviarSoap.mockResolvedValueOnce(
      respostaDaConsulta('100', 'Autorizado o uso da NF-e', protNFe(chave, '100', digest)).replaceAll(CHAVE, chave),
    );
    const r = await consultarProtocolo({
      chaveAcesso: chave,
      xmlAssinado: incerta.xmlAssinado,
      certificado: pfxTeste().certificado,
      ambiente: 'homologacao',
      ufEmitente: 'SP',
    });

    expect(r.success).toBe(true);
    expect(r.status).toBe('autorizado');
    const xml = r.xml!;
    expect(xml.startsWith(`<nfeProc versao="4.00" xmlns="${NS}">`)).toBe(true);
    expect(xml).toContain(`<digVal>${digest}</digVal>`);
    expect(xml).toContain('<verAplic>SP_NFCE_PL_009</verAplic>');
    expect(assinaturaConfere(xml)).toBe(true);
  });

  it('XML assinado que não é o do protocolo (outra chave ou outro digest) não vira nfeProc', () => {
    const assinado = `<NFe xmlns="${NS}"><infNFe Id="NFe${CHAVE}"/><Signature><DigestValue>abc=</DigestValue></Signature></NFe>`;
    const ok = soap(protNFe(CHAVE, '100', 'abc='));
    expect(nfeProcDaConsulta(assinado, CHAVE, ok, '2')).toContain('<nfeProc');
    expect(nfeProcDaConsulta(assinado, CHAVE, soap(protNFe(CHAVE, '100', 'outro=')), '2')).toBeUndefined();
    const outraChave = CHAVE.slice(0, 43) + '9';
    expect(nfeProcDaConsulta(assinado, outraChave, ok, '2')).toBeUndefined();
    expect(nfeProcDaConsulta(assinado, CHAVE, soap(protNFe(CHAVE, '539', 'abc=')), '2')).toBeUndefined();
  });

  it('nota cancelada: status cancelado, cStat 101, protocolo da autorização e o XML do cancelamento', async () => {
    const cce = `<procEventoNFe versao="1.00"><evento versao="1.00"><infEvento><tpEvento>110110</tpEvento></infEvento></evento>${retEvento('110110', '135', '135260000000700')}</procEventoNFe>`;
    const canc = `<procEventoNFe versao="1.00"><evento versao="1.00"><infEvento><tpEvento>110111</tpEvento></infEvento></evento>${retEvento('110111', '135', '135260000000777')}</procEventoNFe>`;
    enviarSoap.mockResolvedValueOnce(
      respostaDaConsulta('101', 'Cancelamento de NF-e homologado', protNFe(CHAVE, '100', 'abc='), cce + canc),
    );
    const r = await consultarProtocolo({
      chaveAcesso: CHAVE,
      certificado: pfxTeste().certificado,
      ufEmitente: 'SP',
    });

    expect(r.success).toBe(false);
    expect(r.status).toBe('cancelado');
    expect(r.codigoStatus).toBe('101');
    expect(r.protocolo).toBe('135260000000001');
    expect(r.xmlCancelamento).toContain('<nProt>135260000000777</nProt>');
    expect(r.xmlCancelamento).not.toContain('110110');
    expect(r.xmlCancelamento!.startsWith(`<procEventoNFe xmlns="${NS}" versao="1.00">`)).toBe(true);
    expect(r.xml).toBeUndefined();
  });

  it('autorizada continua autorizada, sem XML se o emissor não mandou o assinado', async () => {
    enviarSoap.mockResolvedValueOnce(respostaDaConsulta('100', 'Autorizado o uso da NF-e', protNFe(CHAVE, '100', 'abc=')));
    const r = await consultarProtocolo({ chaveAcesso: CHAVE, certificado: pfxTeste().certificado, ufEmitente: 'SP' });
    expect(r.success).toBe(true);
    expect(r.status).toBe('autorizado');
    expect(r.codigoStatus).toBe('100');
    expect(r.xml).toBeUndefined();
    expect(r.xmlCancelamento).toBeUndefined();
  });

  it('extrairProcCancelamento ignora cancelamento recusado e mantém o namespace que já veio', () => {
    const recusado = `<procEventoNFe versao="1.00"><evento><infEvento><tpEvento>110111</tpEvento></infEvento></evento>${retEvento('110111', '573', '1')}</procEventoNFe>`;
    expect(extrairProcCancelamento(soap(recusado))).toBeUndefined();
    const comNs = `<procEventoNFe xmlns="${NS}" versao="1.00"><evento><infEvento><tpEvento>110112</tpEvento></infEvento></evento>${retEvento('110112', '135', '2')}</procEventoNFe>`;
    expect(extrairProcCancelamento(soap(comNs))).toBe(comNs);
  });
});
