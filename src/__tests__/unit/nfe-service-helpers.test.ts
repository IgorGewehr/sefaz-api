/**
 * Helpers puros do nfe.service: parseRetEvento (cStat de eventos) e
 * normalizarAnoInutilizacao (ano com 2 OU 4 dígitos).
 */
import { describe, it, expect } from 'vitest';
import { parseRetEvento, normalizarAnoInutilizacao } from '../../services/nfe.service';

const CHAVE = '35260612345678000195550010000001231100000017';

function retornoEvento(cStat: string, xMotivo: string) {
  return {
    retEnvEvento: {
      cStat: '128',
      xMotivo: 'Lote de evento processado',
      retEvento: {
        infEvento: {
          cStat,
          xMotivo,
          nProt: '135260000000001',
          dhRegEvento: '2026-06-12T10:00:00-03:00',
        },
      },
    },
  };
}

describe('parseRetEvento — cStat de cancelamento', () => {
  it('135 (evento registrado e vinculado) é sucesso', () => {
    const r = parseRetEvento(retornoEvento('135', 'Evento registrado e vinculado a NF-e'), CHAVE);
    expect(r.success).toBe(true);
    expect(r.status).toBe('autorizado');
  });

  it('155 (cancelamento homologado FORA DE PRAZO) é SUCESSO com ressalva preservada', () => {
    const motivo = 'Cancelamento homologado fora de prazo';
    const r = parseRetEvento(retornoEvento('155', motivo), CHAVE);

    expect(r.success).toBe(true);
    expect(r.status).toBe('autorizado');
    expect(r.codigoStatus).toBe('155');
    expect(r.motivoStatus).toBe(motivo); // ressalva visível pro emissor
    expect(r.protocolo).toBe('135260000000001');
  });

  it('rejeição (ex: 573 duplicidade de evento) continua falha', () => {
    const r = parseRetEvento(retornoEvento('573', 'Rejeicao: Duplicidade de Evento'), CHAVE);
    expect(r.success).toBe(false);
    expect(r.status).toBe('rejeitado');
  });
});

describe('normalizarAnoInutilizacao', () => {
  it('aceita ano com 2 dígitos', () => {
    expect(normalizarAnoInutilizacao('26')).toBe('26');
  });

  it('converte ano com 4 dígitos para 2', () => {
    expect(normalizarAnoInutilizacao('2026')).toBe('26');
    expect(normalizarAnoInutilizacao(2026 as unknown as string)).toBe('26');
  });

  it('rejeita formatos inválidos com erro claro', () => {
    expect(() => normalizarAnoInutilizacao('6')).toThrow(/Ano inválido/);
    expect(() => normalizarAnoInutilizacao('202')).toThrow(/Ano inválido/);
    expect(() => normalizarAnoInutilizacao('20260')).toThrow(/Ano inválido/);
    expect(() => normalizarAnoInutilizacao('AB')).toThrow(/Ano inválido/);
    expect(() => normalizarAnoInutilizacao('')).toThrow(/Ano inválido/);
  });
});
