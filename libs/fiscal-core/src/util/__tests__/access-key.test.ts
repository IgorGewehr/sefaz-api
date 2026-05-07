import { describe, expect, it } from 'vitest';
import { calcularDV, montarChaveAcesso, validarChaveAcesso } from '../access-key';

describe('calcularDV', () => {
  it('computes mod-11 DV correctly for known SEFAZ keys', () => {
    // Real authorized key — DV is the last digit
    const known = '35200714200166000187550010000000071000000077';
    expect(calcularDV(known.slice(0, 43))).toBe(known.slice(43));
  });

  it('returns 0 when remainder < 2', () => {
    // pad to 43 digits — DV must be calculable
    expect(calcularDV('0'.repeat(43))).toBe('0');
  });
});

describe('validarChaveAcesso', () => {
  it('rejects keys with bad DV', () => {
    expect(validarChaveAcesso('3'.repeat(44))).toBe(false);
  });
});

describe('montarChaveAcesso', () => {
  it('builds a 44-digit key with valid DV', () => {
    const chave = montarChaveAcesso({
      cUF: '35',
      dataEmissao: new Date('2024-11-28T18:00:00Z'),
      cnpj: '12345678000195',
      modelo: '55',
      serie: '1',
      numero: 123,
      tipoEmissao: '1',
      codigoNumerico: '12345678',
      uf: 'SP',
    });
    expect(chave).toHaveLength(44);
    expect(validarChaveAcesso(chave)).toBe(true);
  });
});
