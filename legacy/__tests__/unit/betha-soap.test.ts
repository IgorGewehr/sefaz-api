/**
 * Testes da estrutura SOAP gerada pelo BethaProvider.
 *
 * Verifica que os envelopes SOAP para Betha Cloud obedecem ao WSDL:
 * https://nota-eletronica.betha.cloud/dps/ws/service.wsdl
 *
 * Namespace: http://www.betha.com.br/e-nota-dps
 * Operações: RecepcionarDps, ConsultarStatusDps, RecepcionarEventoCancelamento
 */

import { describe, it, expect } from 'vitest';
import {
  buildRecepcionarDpsEnvelope,
  buildConsultarStatusEnvelope,
  buildCancelarEnvelope,
  BethaProvider,
} from '../../lib/nfse/betha.provider';
import { buildDpsXml } from '../../lib/nfse/nacional.provider';
import type { NfseEmitirRequest } from '../../types/nfse';

const BETHA_DPS_NS   = 'http://www.betha.com.br/e-nota-dps';
const SEFIN_DPS_NS   = 'http://www.sped.fazenda.gov.br/nfse';
const SOAP_NS        = 'http://schemas.xmlsoap.org/soap/envelope/';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRequest(): NfseEmitirRequest {
  return {
    prestador: {
      cnpj: '12.345.678/0001-90',
      inscricaoMunicipal: '12345',
      nome: 'Prestador Teste',
      endereco: {
        logradouro: 'Rua Teste', numero: '100',
        bairro: 'Centro', codigoMunicipio: '4207601', uf: 'SC', cep: '99890-000',
      },
      optanteSimplesNacional: true,
      regApTribSN: 2,
      regEspTrib: 6,
    },
    tomador: { cnpj: '98.765.432/0001-10', nome: 'Tomador Teste' },
    servico: {
      codigoServico: '01.07',
      codigoTributacaoNacional: '010700',
      discriminacao: 'Serviço teste',
      codigoMunicipioPrestacao: '4207601',
      nbs: '1.0303.00.00',
    },
    valores: { valorServicos: 500, aliquotaIss: 0.05, issRetido: false, exigibilidadeIss: '1' },
    rps: { numero: 1, serie: '1', tipo: '1', dataEmissao: '2026-04-13', naturezaOperacao: '1' },
    certificado: { pfxBase64: 'mock', password: 'mock' },
  };
}

// DPS XML pré-construído com namespace Betha (como betha.provider faz em produção)
const DPS_XML_ASSINADO = buildDpsXml(makeRequest(), BETHA_DPS_NS);

// ── BethaProvider identificação ───────────────────────────────────────────────

describe('BethaProvider', () => {
  it('nome é "Betha Cloud"', () => {
    expect(new BethaProvider().nome).toBe('Betha Cloud');
  });
});

// ── Envelope RecepcionarDps ───────────────────────────────────────────────────

describe('buildRecepcionarDpsEnvelope', () => {
  const envelope = buildRecepcionarDpsEnvelope(DPS_XML_ASSINADO);

  it('começa com declaração XML UTF-8', () => {
    expect(envelope).toMatch(/^<\?xml.*encoding="UTF-8"/);
  });

  it('contém namespace SOAP 1.1', () => {
    expect(envelope).toContain(SOAP_NS);
  });

  it('contém namespace Betha DPS', () => {
    expect(envelope).toContain(BETHA_DPS_NS);
  });

  it('contém wrapper <b:RecepcionarDpsEnvio>', () => {
    expect(envelope).toContain('RecepcionarDpsEnvio');
  });

  it('DPS inline usa namespace Betha (não SEFIN/ADN)', () => {
    expect(envelope).toContain(BETHA_DPS_NS);
    expect(envelope).not.toContain(SEFIN_DPS_NS);
  });

  it('NÃO usa CDATA (é inline, não string)', () => {
    expect(envelope).not.toContain('<![CDATA[');
  });

  it('tem exatamente uma declaração XML (sem aninhamento)', () => {
    const declarations = (envelope.match(/<\?xml/g) || []).length;
    expect(declarations).toBe(1);
  });

  it('contém <soapenv:Body>', () => {
    expect(envelope).toContain('<soapenv:Body>');
  });

  it('DPS original tem versao="1.00" inline no envelope', () => {
    expect(envelope).toContain('versao="1.00"');
  });

  it('contém elemento <infDPS> do DPS original', () => {
    expect(envelope).toContain('infDPS');
  });

  it('infDPS usa atributo id minúsculo (Betha XSD)', () => {
    expect(envelope).toContain('id="DPS');
    expect(envelope).not.toMatch(/infDPS[^>]*\sId="/);
  });

  it('contém cNBS no bloco cServ com 9 dígitos sem pontos', () => {
    expect(envelope).toContain('cNBS');
    // "1.0303.00.00" → normalizado para "103030000" (9 dígitos)
    expect(envelope).toContain('103030000');
    expect(envelope).not.toContain('1.0303.00.00');
  });
});

// ── buildDpsXml — validações específicas Betha ────────────────────────────────

describe('buildDpsXml — Betha Cloud', () => {
  it('lança erro quando nbs está ausente para namespace Betha', () => {
    const req = makeRequest();
    delete (req.servico as any).nbs;
    expect(() => buildDpsXml(req, BETHA_DPS_NS)).toThrow('nbs');
  });

  it('NÃO lança erro quando nbs está ausente para namespace ADN', () => {
    const req = makeRequest();
    delete (req.servico as any).nbs;
    expect(() => buildDpsXml(req)).not.toThrow();
  });
});

// ── Envelope ConsultarStatusDps ───────────────────────────────────────────────

describe('buildConsultarStatusEnvelope', () => {
  const envelope = buildConsultarStatusEnvelope(
    'PROT-2026-001',
    '4207601',
    '12345678000190',
    '2',
  );

  it('contém namespace SOAP 1.1', () => {
    expect(envelope).toContain(SOAP_NS);
  });

  it('contém namespace Betha DPS', () => {
    expect(envelope).toContain(BETHA_DPS_NS);
  });

  it('contém wrapper <b:ConsultarStatusDpsEnvio>', () => {
    expect(envelope).toContain('ConsultarStatusDpsEnvio');
  });

  it('inclui <b:tpAmb> com valor correto', () => {
    expect(envelope).toContain('<b:tpAmb>2</b:tpAmb>');
  });

  it('inclui <b:codigoIbge>', () => {
    expect(envelope).toContain('<b:codigoIbge>4207601</b:codigoIbge>');
  });

  it('inclui <b:cpfCnpjPrestador>', () => {
    expect(envelope).toContain('<b:cpfCnpjPrestador>12345678000190</b:cpfCnpjPrestador>');
  });

  it('inclui <b:protocolo>', () => {
    expect(envelope).toContain('<b:protocolo>PROT-2026-001</b:protocolo>');
  });

  it('inclui <b:tipoIntegracao>EMISSAO</b:tipoIntegracao>', () => {
    expect(envelope).toContain('<b:tipoIntegracao>EMISSAO</b:tipoIntegracao>');
  });
});

// ── Envelope RecepcionarEventoCancelamento ────────────────────────────────────

describe('buildCancelarEnvelope', () => {
  const envelope = buildCancelarEnvelope(
    'CHAVE-ACESSO-50-DIGITOS',
    '12345678000190',
    '1',
    'Erro na emissão',
    '2',
  );

  it('contém namespace SOAP 1.1', () => {
    expect(envelope).toContain(SOAP_NS);
  });

  it('contém namespace Betha DPS', () => {
    expect(envelope).toContain(BETHA_DPS_NS);
  });

  it('contém <b:RecepcionarEventoCancelamentoEnvio>', () => {
    expect(envelope).toContain('RecepcionarEventoCancelamentoEnvio');
  });

  it('contém <b:chNFSe> com a chave informada', () => {
    expect(envelope).toContain('<b:chNFSe>CHAVE-ACESSO-50-DIGITOS</b:chNFSe>');
  });

  it('contém <b:CNPJAutor>', () => {
    expect(envelope).toContain('<b:CNPJAutor>12345678000190</b:CNPJAutor>');
  });

  it('contém <b:cMotivo>1</b:cMotivo>', () => {
    expect(envelope).toContain('<b:cMotivo>1</b:cMotivo>');
  });

  it('contém <b:xMotivo> com texto do motivo', () => {
    expect(envelope).toContain('<b:xMotivo>Erro na emissão</b:xMotivo>');
  });

  it('contém <b:tpAmb>2</b:tpAmb>', () => {
    expect(envelope).toContain('<b:tpAmb>2</b:tpAmb>');
  });

  it('contém <b:verAplic>', () => {
    expect(envelope).toContain('<b:verAplic>');
  });

  it('contém <b:dhEvento> com formato de data SEFAZ', () => {
    expect(envelope).toMatch(/<b:dhEvento>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-\d{2}:\d{2}<\/b:dhEvento>/);
  });

  it('estrutura de evento aninhada: evento > infEvento > pedRegEvento > infPedReg', () => {
    expect(envelope).toContain('<b:evento');
    expect(envelope).toContain('<b:infEvento');
    expect(envelope).toContain('<b:pedRegEvento');
    expect(envelope).toContain('<b:infPedReg');
  });
});

// ── Validação sem certificado real ────────────────────────────────────────────

describe('BethaProvider — validação de entrada (consultar)', () => {
  const provider = new BethaProvider();

  it('retorna erro quando protocolo não é fornecido', async () => {
    const result = await provider.consultar({
      prestador: { cnpj: '12345678000190', inscricaoMunicipal: '12345' },
      certificado: { pfxBase64: 'mock', password: 'mock' },
    });
    expect(result.success).toBe(false);
    expect(result.mensagens?.[0].mensagem).toContain('Protocolo');
  });
});
