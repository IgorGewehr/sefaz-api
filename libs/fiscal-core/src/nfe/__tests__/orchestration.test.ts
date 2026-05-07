import { describe, expect, it } from 'vitest';
import {
  buildEventoCancelamentoXml,
  buildEventoCCeXml,
  buildInutNFeXml,
  buildNfeProcEnvelope,
  interpretarStatus,
  parseRetAutorizacao,
  parseRetEvento,
  wrapConsReciNFe,
  wrapEnviNFe,
} from '../orchestration';

describe('interpretarStatus', () => {
  it('maps SEFAZ codes to canonical statuses', () => {
    expect(interpretarStatus('100')).toBe('autorizado');
    expect(interpretarStatus('150')).toBe('autorizado');
    expect(interpretarStatus('105')).toBe('processando');
    expect(interpretarStatus('110')).toBe('denegado');
    expect(interpretarStatus('301')).toBe('denegado');
    expect(interpretarStatus('135')).toBe('autorizado'); // evento OK
    expect(interpretarStatus('200')).toBe('rejeitado');
    expect(interpretarStatus('999')).toBe('rejeitado');
    expect(interpretarStatus('XXX')).toBe('erro');
  });
});

describe('parseRetAutorizacao', () => {
  it('extracts a successful protNFe (100)', () => {
    const ret = parseRetAutorizacao({
      retEnviNFe: {
        cStat: '104',
        xMotivo: 'Lote processado',
        protNFe: {
          infProt: {
            cStat: '100',
            xMotivo: 'Autorizado o uso da NF-e',
            chNFe: '35'.padEnd(44, '1'),
            nProt: '135240000123456',
            dhRecbto: '2024-11-28T14:32:00-03:00',
          },
        },
      },
    });
    expect(ret.success).toBe(true);
    expect(ret.status).toBe('autorizado');
    expect(ret.protocolo).toBe('135240000123456');
  });

  it('flags processing batches and surfaces nRec', () => {
    const ret = parseRetAutorizacao({
      retEnviNFe: { cStat: '103', xMotivo: 'Lote em processamento', infRec: { nRec: '99999' } },
    });
    expect(ret.success).toBe(false);
    expect(ret.status).toBe('processando');
    expect(ret.nRec).toBe('99999');
  });

  it('handles rejection codes', () => {
    const ret = parseRetAutorizacao({ retEnviNFe: { cStat: '225', xMotivo: 'Falha schema' } });
    expect(ret.success).toBe(false);
    expect(ret.status).toBe('rejeitado');
    expect(ret.codigoStatus).toBe('225');
  });
});

describe('parseRetEvento', () => {
  it('reports success for cancelamento (135)', () => {
    const ret = parseRetEvento(
      {
        retEnvEvento: {
          retEvento: {
            infEvento: { cStat: '135', xMotivo: 'Evento registrado', nProt: '141240000077', dhRegEvento: '2024-11-28T14:32:00-03:00' },
          },
        },
      },
      '3'.padEnd(44, '0'),
    );
    expect(ret.success).toBe(true);
    expect(ret.protocolo).toBe('141240000077');
  });

  it('reports failure for batch-level rejection', () => {
    const ret = parseRetEvento({ retEnvEvento: { cStat: '215', xMotivo: 'Falha' } }, '0'.repeat(44));
    expect(ret.success).toBe(false);
    expect(ret.status).toBe('rejeitado');
  });
});

describe('envelope builders', () => {
  const signedNFe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe35..."></infNFe><Signature/></NFe>`;

  it('wraps signed NFe in enviNFe', () => {
    const env = wrapEnviNFe(signedNFe, '12345', '1');
    expect(env).toContain('<idLote>12345</idLote>');
    expect(env).toContain('<indSinc>1</indSinc>');
    expect(env).toContain('<NFe');
  });

  it('throws when signed XML lacks an NFe element', () => {
    expect(() => wrapEnviNFe('<foo/>', '1', '1')).toThrow(/extrair o elemento NFe/);
  });

  it('builds consReciNFe with tpAmb + nRec', () => {
    const body = wrapConsReciNFe('REC-1', '2');
    expect(body).toContain('<tpAmb>2</tpAmb>');
    expect(body).toContain('<nRec>REC-1</nRec>');
  });

  it('builds nfeProc envelope with protocol details', () => {
    const proc = buildNfeProcEnvelope(
      signedNFe,
      {
        success: true,
        status: 'autorizado',
        codigoStatus: '100',
        motivoStatus: 'Autorizado',
        chaveAcesso: '3'.padEnd(44, '0'),
        protocolo: '135',
        dataRecebimento: '2024-11-28T14:32:00-03:00',
      },
      '1',
    );
    expect(proc).toContain('<nfeProc');
    expect(proc).toContain('<nProt>135</nProt>');
    expect(proc).toContain('<cStat>100</cStat>');
  });
});

describe('event XML builders', () => {
  const chave = '35200714200166000187550010000000071000000077';

  it('builds cancellation event with required fields', () => {
    const xml = buildEventoCancelamentoXml({
      chaveAcesso: chave,
      protocolo: '141200000000000',
      justificativa: 'Erro de digitação na quantidade',
      ufEmitente: 'SP',
      tpAmb: '2',
      loteId: '1',
    });
    expect(xml).toContain('<descEvento>Cancelamento</descEvento>');
    expect(xml).toContain(`<chNFe>${chave}</chNFe>`);
    expect(xml).toContain('<tpEvento>110111</tpEvento>');
    expect(xml).toContain('<xJust>Erro de digitação na quantidade</xJust>');
  });

  it('builds CC-e event with sequence number', () => {
    const xml = buildEventoCCeXml({
      chaveAcesso: chave,
      correcao: 'Correção da descrição do produto X',
      sequencia: 2,
      ufEmitente: 'SP',
      tpAmb: '2',
      loteId: '1',
    });
    expect(xml).toContain('<descEvento>Carta de Correcao</descEvento>');
    expect(xml).toContain('<nSeqEvento>2</nSeqEvento>');
    expect(xml).toContain('xCondUso');
  });

  it('builds inutilização XML with valid Id format', () => {
    const xml = buildInutNFeXml({
      cnpj: '12345678000195',
      cUF: '35',
      ano: '24',
      modelo: '55',
      serie: '1',
      numeroInicial: 100,
      numeroFinal: 110,
      justificativa: 'Salto de numeração por falha do sistema',
      tpAmb: '2',
    });
    expect(xml).toMatch(/Id="ID3524123456780001955500\d/);
    expect(xml).toContain('<nNFIni>100</nNFIni>');
    expect(xml).toContain('<nNFFin>110</nNFFin>');
  });
});
