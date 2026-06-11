/**
 * Regressão: o nfeProc devolvido ao emissor precisa ser well-formed e carregar
 * o protNFe LITERAL retornado pela SEFAZ (verAplic/digVal reais), não um
 * reconstruído. Bug original: prólogo <?xml?> do XML assinado concatenado no
 * meio do envelope + protNFe fabricado com verAplic falso.
 */
import { describe, it, expect } from 'vitest';
import { buildNfeProcEnvelope, extrairProtNFe } from '../../services/nfe.service';
import type { SefazResponse } from '../../types';

const CHAVE = '35260612345678000190550010000000011000000010';

const SIGNED_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">` +
  `<infNFe Id="NFe${CHAVE}" versao="4.00"><ide><mod>55</mod></ide></infNFe>` +
  `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature>` +
  `</NFe>`;

const PROT_NFE_REAL =
  `<protNFe versao="4.00"><infProt Id="ID${CHAVE}">` +
  `<tpAmb>2</tpAmb><verAplic>SVRS202602</verAplic><chNFe>${CHAVE}</chNFe>` +
  `<dhRecbto>2026-06-11T10:00:00-03:00</dhRecbto><nProt>135260000000001</nProt>` +
  `<digVal>abc123=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>` +
  `</infProt></protNFe>`;

const SOAP_RESPONSE =
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
  `<nfeResultMsg><retEnviNFe versao="4.00"><tpAmb>2</tpAmb><cStat>104</cStat>` +
  `<xMotivo>Lote processado</xMotivo>${PROT_NFE_REAL}</retEnviNFe></nfeResultMsg>` +
  `</soap:Body></soap:Envelope>`;

function makeResultado(extra: Partial<SefazResponse> = {}): SefazResponse {
  return {
    success: true,
    status: 'autorizado',
    codigoStatus: '100',
    motivoStatus: 'Autorizado o uso da NF-e',
    chaveAcesso: CHAVE,
    protocolo: '135260000000001',
    dataRecebimento: '2026-06-11T10:00:00-03:00',
    ...extra,
  };
}

describe('extrairProtNFe', () => {
  it('extrai o fragmento protNFe literal da resposta SOAP', () => {
    expect(extrairProtNFe(SOAP_RESPONSE)).toBe(PROT_NFE_REAL);
  });

  it('retorna undefined quando a resposta não contém protNFe', () => {
    expect(extrairProtNFe('<retEnviNFe><cStat>225</cStat></retEnviNFe>')).toBeUndefined();
  });
});

describe('buildNfeProcEnvelope', () => {
  it('não inclui prólogo <?xml?> no meio do documento', () => {
    const xml = buildNfeProcEnvelope(SIGNED_XML, makeResultado(), '2');
    expect(xml).not.toContain('<?xml');
    expect(xml.startsWith('<nfeProc')).toBe(true);
  });

  it('usa o protNFe literal da SEFAZ quando disponível (verAplic/digVal reais)', () => {
    const xml = buildNfeProcEnvelope(SIGNED_XML, makeResultado({ protNFeXml: PROT_NFE_REAL }), '2');
    expect(xml).toContain(PROT_NFE_REAL);
    expect(xml).toContain('<verAplic>SVRS202602</verAplic>');
    expect(xml).toContain('<digVal>abc123=</digVal>');
    expect(xml).not.toContain('SefazAPI-1.0');
  });

  it('preserva a NFe assinada completa dentro do envelope', () => {
    const xml = buildNfeProcEnvelope(SIGNED_XML, makeResultado({ protNFeXml: PROT_NFE_REAL }), '2');
    expect(xml).toContain(`<infNFe Id="NFe${CHAVE}"`);
    expect(xml).toContain('<SignedInfo/>');
    // NFe vem antes do protNFe, ambos dentro de nfeProc
    expect(xml.indexOf('</NFe>')).toBeLessThan(xml.indexOf('<protNFe'));
    expect(xml.endsWith('</nfeProc>')).toBe(true);
  });

  it('fallback reconstruído quando protNFeXml ausente continua well-formed', () => {
    const xml = buildNfeProcEnvelope(SIGNED_XML, makeResultado(), '2');
    expect(xml).toContain(`<chNFe>${CHAVE}</chNFe>`);
    expect(xml).toContain('<nProt>135260000000001</nProt>');
    expect(xml).not.toContain('<?xml');
  });
});
