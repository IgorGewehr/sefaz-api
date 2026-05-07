import { describe, expect, it } from 'vitest';
import {
  buildMdfeConsSit,
  buildMdfeConsStatServ,
  parseMdfeConsultaRetorno,
  parseMdfeEventoRetorno,
  parseMdfeRetorno,
  parseMdfeStatusRetorno,
  wrapMdfeConsulta,
  wrapMdfeEvento,
  wrapMdfeRecepcaoSinc,
  wrapMdfeStatus,
} from '../orchestration';

const chave = '35'.padEnd(44, '1');

describe('parseMdfeRetorno', () => {
  it('flags AUTHORIZED with protocol when cStat=100', () => {
    const r = parseMdfeRetorno(
      {
        retMDFe: {
          cStat: '100',
          xMotivo: 'Autorizado',
          protMDFe: { infProt: { nProt: '141200000999', dhRecbto: '2024-11-28T14:32:00-03:00' } },
        },
      },
      chave,
    );
    expect(r.success).toBe(true);
    expect(r.status).toBe('autorizado');
    expect(r.protocolo).toBe('141200000999');
  });

  it('reports processando for 103/104/105', () => {
    expect(parseMdfeRetorno({ retMDFe: { cStat: '103', xMotivo: 'Lote' } }, chave).status).toBe(
      'processando',
    );
  });

  it('reports denegado for 3xx codes', () => {
    expect(parseMdfeRetorno({ retMDFe: { cStat: '301', xMotivo: 'Denegado' } }, chave).status).toBe(
      'denegado',
    );
  });

  it('falls back to rejeitado otherwise', () => {
    const r = parseMdfeRetorno({ retMDFe: { cStat: '215', xMotivo: 'Falha schema' } }, chave);
    expect(r.success).toBe(false);
    expect(r.status).toBe('rejeitado');
  });
});

describe('parseMdfeConsultaRetorno', () => {
  it('detects cancelled MDF-e (cStat=101)', () => {
    const r = parseMdfeConsultaRetorno(
      { retConsSitMDFe: { cStat: '101', protMDFe: { infProt: { nProt: '999' } } } },
      chave,
    );
    expect(r.status).toBe('cancelado');
    expect(r.protocolo).toBe('999');
  });
});

describe('parseMdfeEventoRetorno', () => {
  it('reports success for evento 135', () => {
    const r = parseMdfeEventoRetorno(
      {
        retEventoMDFe: {
          infEvento: { cStat: '135', xMotivo: 'Evento OK', nProt: '888', dhRegEvento: '2024-11-28T14:32:00-03:00' },
        },
      },
      chave,
    );
    expect(r.success).toBe(true);
    expect(r.protocolo).toBe('888');
  });

  it('flags rejection for non-135/136', () => {
    const r = parseMdfeEventoRetorno(
      { retEventoMDFe: { infEvento: { cStat: '215', xMotivo: 'Falha' } } },
      chave,
    );
    expect(r.success).toBe(false);
    expect(r.status).toBe('rejeitado');
  });
});

describe('parseMdfeStatusRetorno', () => {
  it('returns success when cStat=107', () => {
    expect(parseMdfeStatusRetorno({ retConsStatServMDFe: { cStat: '107', xMotivo: 'OK' } }).success).toBe(true);
  });
});

describe('SOAP body wrappers', () => {
  it('wraps recepção, consulta, status, evento with proper namespace', () => {
    expect(wrapMdfeRecepcaoSinc('<MDFe/>')).toContain('mdfeRecepcaoSinc');
    expect(wrapMdfeConsulta('<x/>')).toContain('mdfeConsultaMDFe');
    expect(wrapMdfeStatus('<y/>')).toContain('mdfeStatusServico');
    expect(wrapMdfeEvento('<z/>')).toContain('mdfeRecepcaoEvento');
  });

  it('builds consSit and consStatServ XMLs', () => {
    expect(buildMdfeConsSit(chave, '2')).toContain(`<chMDFe>${chave}</chMDFe>`);
    expect(buildMdfeConsStatServ('1')).toContain('<xServ>STATUS</xServ>');
  });
});
