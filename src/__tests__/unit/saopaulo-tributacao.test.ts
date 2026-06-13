/**
 * resolveTributacao (Nota Paulistana) — domínio TipoTributacao conferido no
 * ACBr (frones/ACBr master, ACBrNFSeXProviderBase.pas →
 * TipoTributacaoRPSToStr): T/F, A/B, M/N, X/V, P. NÃO existe código para
 * "não incidência" (exigibilidadeIss=2) — mapear pra 'T' cobraria ISS de
 * operação fora do campo de incidência.
 */
import { describe, it, expect } from 'vitest';
import { resolveTributacao } from '../../lib/nfse/saopaulo.provider';
import type { NfseEmitirRequest } from '../../types/nfse';

function makeRequest(exigibilidadeIss: string, codigoMunicipioPrestacao = '3550308'): NfseEmitirRequest {
  return {
    prestador: {
      cnpj: '12345678000195',
      inscricaoMunicipal: '12345678',
      nome: 'Prestador SP',
    },
    tomador: { nome: 'Tomador Teste' },
    servico: {
      codigoServico: '01.07',
      discriminacao: 'Servico de teste',
      codigoMunicipioPrestacao,
    },
    valores: {
      valorServicos: 1000,
      aliquotaIss: 0.05,
      issRetido: false,
      exigibilidadeIss: exigibilidadeIss as NfseEmitirRequest['valores']['exigibilidadeIss'],
    },
    rps: { numero: 1, serie: 'A', tipo: '1', dataEmissao: '2026-06-12' },
    certificado: { pfxBase64: 'mock', password: 'mock' },
  } as NfseEmitirRequest;
}

describe('resolveTributacao — Nota Paulistana', () => {
  it('exigível (1): T em SP, F fora', () => {
    expect(resolveTributacao(makeRequest('1'))).toBe('T');
    expect(resolveTributacao(makeRequest('1', '4207601'))).toBe('F');
  });

  it('isenção (3): A em SP, B fora', () => {
    expect(resolveTributacao(makeRequest('3'))).toBe('A');
    expect(resolveTributacao(makeRequest('3', '4207601'))).toBe('B');
  });

  it('exportação (4): P', () => {
    expect(resolveTributacao(makeRequest('4'))).toBe('P');
  });

  it('imunidade (5): M em SP, N fora', () => {
    expect(resolveTributacao(makeRequest('5'))).toBe('M');
    expect(resolveTributacao(makeRequest('5', '4207601'))).toBe('N');
  });

  it('suspensa (6/7): X em SP, V fora', () => {
    expect(resolveTributacao(makeRequest('6'))).toBe('X');
    expect(resolveTributacao(makeRequest('7', '4207601'))).toBe('V');
  });

  it('não incidência (2) é rejeitada com erro claro — sem código no domínio SP', () => {
    expect(() => resolveTributacao(makeRequest('2'))).toThrow(/não incidência/);
    expect(() => resolveTributacao(makeRequest('2'))).toThrow(/T\/F\/A\/B\/M\/N\/X\/V\/P/);
  });
});
