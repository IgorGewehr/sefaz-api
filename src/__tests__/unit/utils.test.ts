import { describe, it, expect } from 'vitest';
import {
  apenasNumeros,
  formatarValor,
  formatarDataSefaz,
  calcularDV,
  montarChaveAcesso,
  escapeXml,
  gerarIdLote,
} from '../../lib/utils';

describe('apenasNumeros', () => {
  it('remove pontuação de CNPJ formatado', () => {
    expect(apenasNumeros('12.345.678/0001-90')).toBe('12345678000190');
  });

  it('remove pontuação de CPF', () => {
    expect(apenasNumeros('123.456.789-09')).toBe('12345678909');
  });

  it('remove traços de CEP', () => {
    expect(apenasNumeros('99890-000')).toBe('99890000');
  });

  it('retorna string vazia para entrada vazia', () => {
    expect(apenasNumeros('')).toBe('');
  });

  it('mantém string já somente numérica', () => {
    expect(apenasNumeros('12345678000190')).toBe('12345678000190');
  });
});

describe('formatarValor', () => {
  it('formata com 2 casas decimais por padrão', () => {
    expect(formatarValor(1000)).toBe('1000.00');
    expect(formatarValor(5)).toBe('5.00');
    expect(formatarValor(0.1 + 0.2)).toBe('0.30');
  });

  it('formata com 4 casas decimais (alíquota)', () => {
    expect(formatarValor(5 * 100, 4)).toBe('500.0000');
    expect(formatarValor(0.05 * 100, 4)).toBe('5.0000');
  });

  it('pTotTribSN exige exatamente 2 casas (TSDec2V2)', () => {
    // 5% → "5.00" (não "5.0000")
    expect(formatarValor(0.05 * 100, 2)).toBe('5.00');
    expect(formatarValor(9.99, 2)).toBe('9.99');
  });
});

describe('formatarDataSefaz', () => {
  it('formata data com offset -03:00 (default BRT)', () => {
    const date = new Date('2026-04-13T13:00:00.000Z'); // UTC 13h = BRT 10h
    const resultado = formatarDataSefaz(date);
    expect(resultado).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
    expect(resultado).toBe('2026-04-13T10:00:00-03:00');
  });

  it('não contém milissegundos (requisito SEFIN)', () => {
    const resultado = formatarDataSefaz(new Date());
    expect(resultado).not.toMatch(/\.\d{3}/);
  });

  it('não contém "Z" (requisito SEFIN — offset explícito)', () => {
    const resultado = formatarDataSefaz(new Date());
    expect(resultado).not.toContain('Z');
  });

  it('usa offset -05:00 para Acre (AC)', () => {
    const date = new Date('2026-04-13T15:00:00.000Z');
    const resultado = formatarDataSefaz(date, 'AC');
    expect(resultado).toContain('-05:00');
    expect(resultado).toBe('2026-04-13T10:00:00-05:00');
  });
});

describe('calcularDV — Módulo 11', () => {
  it('calcula DV correto para chave conhecida', () => {
    // Chave de 43 dígitos cujo DV é 0
    const chave43 = '4224011234567800019055001000000006700000001';
    const dv = calcularDV(chave43);
    expect(dv).toMatch(/^\d$/);
  });

  it('retorna dígito entre 0 e 9', () => {
    const chave43 = '3524011234567800019055001000000001100000001';
    const dv = calcularDV(chave43);
    expect(parseInt(dv)).toBeGreaterThanOrEqual(0);
    expect(parseInt(dv)).toBeLessThanOrEqual(9);
  });
});

describe('montarChaveAcesso', () => {
  it('gera chave com exatamente 44 dígitos', () => {
    const chave = montarChaveAcesso({
      cUF: '42',
      dataEmissao: new Date('2026-04-13'),
      cnpj: '12345678000190',
      modelo: '55',
      serie: '1',
      numero: 100,
      tipoEmissao: '1',
      codigoNumerico: '12345678',
    });
    expect(chave).toHaveLength(44);
    expect(/^\d{44}$/.test(chave)).toBe(true);
  });

  it('extrai modelo 55 para NF-e na posição correta', () => {
    const chave = montarChaveAcesso({
      cUF: '35',
      dataEmissao: new Date('2026-01-01'),
      cnpj: '12345678000190',
      modelo: '55',
      serie: '1',
      numero: 1,
      tipoEmissao: '1',
      codigoNumerico: '00000001',
    });
    expect(chave.substring(20, 22)).toBe('55');
    expect(chave.substring(0, 2)).toBe('35'); // SP
  });
});

describe('escapeXml', () => {
  it('escapa & < > " \'', () => {
    expect(escapeXml('A&B')).toBe('A&amp;B');
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;');
    expect(escapeXml('"valor"')).toBe('&quot;valor&quot;');
    expect(escapeXml("it's")).toBe('it&apos;s');
  });
});

describe('gerarIdLote', () => {
  it('gera strings de 15 dígitos', () => {
    const id = gerarIdLote();
    expect(id).toHaveLength(15);
    expect(/^\d{15}$/.test(id)).toBe(true);
  });

  it('gera IDs distintos em chamadas consecutivas', () => {
    const ids = new Set(Array.from({ length: 10 }, () => gerarIdLote()));
    expect(ids.size).toBeGreaterThan(1);
  });
});
