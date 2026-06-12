/**
 * Testes do evento de cancelamento NFS-e Padrão Nacional (e101101) e da
 * derivação do Id do DPS para consulta na SEFIN.
 *
 * Contrato (tiposEventos_v1.00.xsd / tiposSimples_v1.00.xsd):
 *   - pedRegEvento@versao + infPedReg@Id (TSIdPedRefEvt: PRE[0-9]{56})
 *   - infPedReg: tpAmb → verAplic → dhEvento → CNPJAutor|CPFAutor → chNFSe → e101101
 *   - e101101: xDesc("Cancelamento de NFS-e") → cMotivo(1|2|9) → xMotivo(15–255)
 *   - payload: XML assinado → GZip → Base64 em { pedidoRegistroEventoXmlGZipB64 }
 */

import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import {
  buildEventoCancelamentoXml,
  montarMotivoCancelamento,
  montarIdDps,
  gzipBase64,
  buildDpsXml,
} from '../../lib/nfse/nacional.provider';
import type { NfseEmitirRequest } from '../../types/nfse';

const CHAVE_50 = '12345678901234567890123456789012345678901234567890';
const CNPJ = '12345678000190';

function makeEvento(overrides: Partial<Parameters<typeof buildEventoCancelamentoXml>[0]> = {}) {
  return buildEventoCancelamentoXml({
    chaveAcesso: CHAVE_50,
    documentoAutor: CNPJ,
    cMotivo: '1',
    xMotivo: 'Cancelamento por erro na emissao da NFS-e',
    ambiente: 'homologacao',
    ...overrides,
  });
}

// ── Estrutura do XML do evento ───────────────────────────────────────────────

describe('buildEventoCancelamentoXml — estrutura', () => {
  it('raiz <pedRegEvento> com namespace do Padrão Nacional e versao="1.00"', () => {
    const xml = makeEvento();
    expect(xml).toContain('<pedRegEvento');
    expect(xml).toContain('xmlns="http://www.sped.fazenda.gov.br/nfse"');
    expect(xml).toContain('versao="1.00"');
  });

  it('elementos do infPedReg na ordem do XSD: tpAmb → verAplic → dhEvento → CNPJAutor → chNFSe → e101101', () => {
    const xml = makeEvento();
    const ordem = ['<tpAmb>', '<verAplic>', '<dhEvento>', '<CNPJAutor>', '<chNFSe>', '<e101101>'];
    const posicoes = ordem.map(tag => xml.indexOf(tag));
    for (let i = 0; i < posicoes.length; i++) {
      expect(posicoes[i]).toBeGreaterThan(-1);
      if (i > 0) expect(posicoes[i]).toBeGreaterThan(posicoes[i - 1]);
    }
  });

  it('e101101 contém xDesc fixo → cMotivo → xMotivo nessa ordem', () => {
    const xml = makeEvento();
    expect(xml).toContain('<xDesc>Cancelamento de NFS-e</xDesc>');
    const posXDesc = xml.indexOf('<xDesc>');
    const posCMotivo = xml.indexOf('<cMotivo>');
    const posXMotivo = xml.indexOf('<xMotivo>');
    expect(posXDesc).toBeGreaterThan(-1);
    expect(posCMotivo).toBeGreaterThan(posXDesc);
    expect(posXMotivo).toBeGreaterThan(posCMotivo);
  });

  it('tpAmb=2 em homologação e tpAmb=1 em produção', () => {
    expect(makeEvento()).toContain('<tpAmb>2</tpAmb>');
    expect(makeEvento({ ambiente: 'producao' })).toContain('<tpAmb>1</tpAmb>');
  });

  it('chNFSe contém a chave de 50 dígitos', () => {
    expect(makeEvento()).toContain(`<chNFSe>${CHAVE_50}</chNFSe>`);
  });

  it('dhEvento com offset de timezone explícito (TSDateTimeUTC, sem ms/Z)', () => {
    const xml = makeEvento();
    expect(xml).toMatch(/<dhEvento>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-\d{2}:\d{2}<\/dhEvento>/);
  });

  it('autor com CPF (11 dígitos) usa <CPFAutor>', () => {
    const xml = makeEvento({ documentoAutor: '12345678909' });
    expect(xml).toContain('<CPFAutor>12345678909</CPFAutor>');
    expect(xml).not.toContain('<CNPJAutor>');
  });

  it('xMotivo com caracteres especiais sai escapado (sem XML injection)', () => {
    const xml = makeEvento({ xMotivo: 'Cancelamento <urgente> & "necessario" conforme contrato' });
    expect(xml).toContain('&lt;urgente&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<urgente>');
  });

  it('rejeita chave de acesso que não tenha 50 dígitos', () => {
    expect(() => makeEvento({ chaveAcesso: '123' })).toThrow(/50 dígitos/);
  });

  it('rejeita documento do autor que não seja CPF nem CNPJ', () => {
    expect(() => makeEvento({ documentoAutor: '123' })).toThrow(/CNPJ.*CPF/);
  });
});

// ── Id do pedRegEvento (TSIdPedRefEvt) ───────────────────────────────────────

describe('buildEventoCancelamentoXml — Id do infPedReg', () => {
  it('Id = "PRE" + chave(50) + tipoEvento 101101 (6) = 59 chars', () => {
    const xml = makeEvento();
    const id = xml.match(/<infPedReg[^>]*Id="([^"]+)"/)?.[1];
    expect(id).toBeDefined();
    expect(id).toBe(`PRE${CHAVE_50}101101`);
    expect(id).toHaveLength(59);
  });

  it('Id obedece ao pattern do XSD: PRE[0-9]{56}', () => {
    const xml = makeEvento();
    const id = xml.match(/<infPedReg[^>]*Id="([^"]+)"/)![1];
    expect(id).toMatch(/^PRE[0-9]{56}$/);
  });
});

// ── Mapeamento de motivo ─────────────────────────────────────────────────────

describe('montarMotivoCancelamento', () => {
  it('códigos 1 e 2 são mantidos; 3 e 4 viram 9 (Outros) no TSCodJustCanc', () => {
    expect(montarMotivoCancelamento('1').cMotivo).toBe('1');
    expect(montarMotivoCancelamento('2').cMotivo).toBe('2');
    expect(montarMotivoCancelamento('3').cMotivo).toBe('9');
    expect(montarMotivoCancelamento('4').cMotivo).toBe('9');
  });

  it('motivo informado com ≥15 chars é usado como xMotivo', () => {
    const { xMotivo } = montarMotivoCancelamento('1', 'Nota emitida com valor incorreto');
    expect(xMotivo).toBe('Nota emitida com valor incorreto');
  });

  it('motivo curto (<15 chars, mínimo do TSMotivo) cai no fallback', () => {
    const { xMotivo } = montarMotivoCancelamento('2', 'curto');
    expect(xMotivo.length).toBeGreaterThanOrEqual(15);
    expect(xMotivo).toContain('servico nao prestado');
  });

  it('motivo longo é truncado em 255 chars (máximo do TSMotivo)', () => {
    const { xMotivo } = montarMotivoCancelamento('1', 'x'.repeat(300));
    expect(xMotivo).toHaveLength(255);
  });
});

// ── GZip + Base64 round-trip ─────────────────────────────────────────────────

describe('gzipBase64 — empacotamento do payload SEFIN', () => {
  it('round-trip: gunzip(base64decode(gzipBase64(xml))) === xml', () => {
    const xml = makeEvento();
    const b64 = gzipBase64(xml);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/); // base64 válido
    const roundTrip = zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf-8');
    expect(roundTrip).toBe(xml);
  });

  it('payload é GZip de verdade (magic number 1f 8b)', () => {
    const buf = Buffer.from(gzipBase64('<x/>'), 'base64');
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);
  });
});

// ── Derivação do Id do DPS (consulta pós-timeout) ────────────────────────────

describe('montarIdDps — derivação compartilhada emissão/consulta', () => {
  it('Id = DPS + cLocEmi(7) + "2" + CNPJ(14) + serie(5) + nDPS(15) = 45 chars', () => {
    const id = montarIdDps({ codigoMunicipio: '4207601', cnpj: CNPJ, serie: '1', numero: 67 });
    expect(id).toBe('DPS420760121234567800019000001000000000000067');
    expect(id).toHaveLength(45);
  });

  it('série alfanumérica vira "1" (mesma regra da emissão)', () => {
    const id = montarIdDps({ codigoMunicipio: '4207601', cnpj: CNPJ, serie: 'A', numero: 1 });
    expect(id.substring(25, 30)).toBe('00001');
  });

  it('CNPJ com pontuação e município curto são normalizados (apenasNumeros + padStart)', () => {
    const id = montarIdDps({ codigoMunicipio: '123', cnpj: '12.345.678/0001-90', serie: '3', numero: 5 });
    expect(id.substring(3, 10)).toBe('0000123');
    expect(id.substring(11, 25)).toBe('12345678000190');
    expect(id.substring(25, 30)).toBe('00003');
  });

  it('é idêntico ao Id da infDPS gerado pelo buildDpsXml (nunca diverge da emissão)', () => {
    const request: NfseEmitirRequest = {
      prestador: {
        cnpj: '12.345.678/0001-90',
        inscricaoMunicipal: '12345',
        nome: 'Prestador Teste',
        endereco: {
          logradouro: 'Rua Teste', numero: '100', bairro: 'Centro',
          codigoMunicipio: '4207601', uf: 'SC', cep: '99890-000',
        },
        optanteSimplesNacional: true,
        regApTribSN: 2,
        regEspTrib: 6,
      },
      tomador: { cnpj: '98.765.432/0001-10', nome: 'Tomador Teste Ltda' },
      servico: {
        codigoServico: '01.07',
        codigoTributacaoNacional: '010700',
        discriminacao: 'Servicos de tecnologia',
        codigoMunicipioPrestacao: '4207601',
        idTribMun: '1',
      },
      valores: { valorServicos: 1000, aliquotaIss: 0.05, issRetido: false, exigibilidadeIss: '1' },
      rps: { numero: 67, serie: 'A', tipo: '1', dataEmissao: '2026-04-13', naturezaOperacao: '1' },
      certificado: { pfxBase64: 'mock', password: 'mock' },
    };

    const xml = buildDpsXml(request);
    const idEmissao = xml.match(/Id="([^"]+)"/)![1];
    const idConsulta = montarIdDps({
      codigoMunicipio: '4207601',
      cnpj: '12.345.678/0001-90',
      serie: 'A',
      numero: 67,
    });
    expect(idConsulta).toBe(idEmissao);
  });
});
