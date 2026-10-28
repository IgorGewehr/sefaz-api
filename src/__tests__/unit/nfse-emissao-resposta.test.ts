/**
 * A resposta do POST /nfse da SEFIN Nacional: `{ idDps, chaveAcesso, nfseXmlGZipB64 }`. O número, o
 * código de verificação e a emissão saem do XML; a chave (que o cancelamento exige) vem junto.
 */
import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { parseEmitirResponse } from '../../lib/nfse/nacional.provider';

const CHAVE = '43051082112233000181000000000004226100000000000017';

function xmlNfse(): string {
  return (
    `<NFSe><infNFSe Id="NFS${CHAVE}"><nNFSe>42</nNFSe><cNFSe>ABC123</cNFSe>` +
    `<dhEmi>2026-10-28T10:00:00-03:00</dhEmi></infNFSe></NFSe>`
  );
}

describe('parseEmitirResponse — SEFIN Nacional', () => {
  it('lê a chave, o XML e o número da resposta de verdade', () => {
    const r = parseEmitirResponse(201, {
      idDps: 'DPS430510821122330001810000100000000000000042',
      chaveAcesso: CHAVE,
      nfseXmlGZipB64: zlib.gzipSync(Buffer.from(xmlNfse())).toString('base64'),
    });
    expect(r.success).toBe(true);
    expect(r.status).toBe('autorizado');
    expect(r.chaveAcesso).toBe(CHAVE);
    expect(r.numeroNfse).toBe(42);
    expect(r.codigoVerificacao).toBe('ABC123');
    expect(r.dataEmissao).toBe('2026-10-28T10:00:00-03:00');
    expect(r.xml).toBe(xmlNfse());
    expect(r.protocolo).toBe('DPS430510821122330001810000100000000000000042');
  });

  it('sem a chave no corpo, tira do Id do XML', () => {
    const r = parseEmitirResponse(201, {
      nfseXmlGZipB64: zlib.gzipSync(Buffer.from(xmlNfse())).toString('base64'),
    });
    expect(r.chaveAcesso).toBe(CHAVE);
  });

  it('o formato antigo (nfse.infNFSe em JSON) continua lido', () => {
    const r = parseEmitirResponse(200, { nfse: { infNFSe: { nNFSe: '7', cNFSe: 'X' } }, idDPS: 'D' });
    expect(r.numeroNfse).toBe(7);
    expect(r.protocolo).toBe('D');
  });

  it('rejeição e erro', () => {
    expect(parseEmitirResponse(400, { erros: [{ Codigo: 'E1', Descricao: 'x' }] }).status).toBe('rejeitado');
    expect(parseEmitirResponse(503, {}).status).toBe('erro');
  });
});
