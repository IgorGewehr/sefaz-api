import { describe, it, expect } from 'vitest';
import { resolveProviderType, getBethaMunicipios } from '../../lib/nfse/provider-config';
import { getProvider, getProviderName } from '../../lib/nfse/provider-factory';

describe('resolveProviderType', () => {
  it('retorna "betha" para Ipira/SC (4207601)', () => {
    expect(resolveProviderType('4207601')).toBe('betha');
  });

  it('retorna "betha" para Florianópolis/SC (4205407)', () => {
    expect(resolveProviderType('4205407')).toBe('betha');
  });

  it('retorna "betha" para São José/SC (4216402)', () => {
    expect(resolveProviderType('4216402')).toBe('betha');
  });

  it('retorna "saopaulo" para São Paulo/SP (3550308)', () => {
    expect(resolveProviderType('3550308')).toBe('saopaulo');
  });

  it('retorna "nacional" para município desconhecido', () => {
    expect(resolveProviderType('9999999')).toBe('nacional');
  });

  it('retorna "nacional" para string vazia', () => {
    expect(resolveProviderType('')).toBe('nacional');
  });

  it('tolera código com pontuação (ex: "4.207.601")', () => {
    expect(resolveProviderType('4.207.601')).toBe('betha');
  });
});

describe('getBethaMunicipios', () => {
  it('retorna array com pelo menos 5 municípios', () => {
    expect(getBethaMunicipios().length).toBeGreaterThanOrEqual(5);
  });

  it('inclui Ipira/SC (4207601)', () => {
    expect(getBethaMunicipios()).toContain('4207601');
  });

  it('inclui Florianópolis/SC (4205407)', () => {
    expect(getBethaMunicipios()).toContain('4205407');
  });
});

describe('getProvider / getProviderName', () => {
  it('retorna BethaProvider para Ipira', () => {
    expect(getProviderName('4207601')).toBe('Betha Cloud');
  });

  it('retorna SaoPauloProvider para São Paulo', () => {
    expect(getProviderName('3550308')).toBe('São Paulo (Nota Fiscal Paulistana)');
  });

  it('provider Betha tem método emitir', () => {
    const p = getProvider('4207601');
    expect(typeof p.emitir).toBe('function');
  });

  it('provider Nacional tem método emitir', () => {
    const p = getProvider('3550308');
    expect(typeof p.emitir).toBe('function');
  });

  it('reutiliza a mesma instância (singleton)', () => {
    const p1 = getProvider('4207601');
    const p2 = getProvider('4207601');
    expect(p1).toBe(p2);
  });
});
