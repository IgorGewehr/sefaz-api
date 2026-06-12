/**
 * Testes do buildDpsXml — verifica que o XML DPS gerado obedece ao
 * XSD do Padrão Nacional NFS-e (Sefin/ADN) e ao schema Betha Cloud.
 *
 * Cobre: TSIdDPS, ordem de elementos, Simples Nacional vs Regime Normal,
 *        pTotTribSN (TSDec2V2), dhEmi sem ms/Z, endereço tomador, etc.
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { buildDpsXml } from '../../lib/nfse/nacional.provider';
import type { NfseEmitirRequest } from '../../types/nfse';

// ── Helpers ─────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
});

function parse(xml: string) {
  return xmlParser.parse(xml);
}

function getInfDPS(xml: string) {
  const doc = parse(xml);
  return doc?.DPS?.infDPS ?? doc?.['ns0:DPS']?.['ns0:infDPS'];
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<NfseEmitirRequest> = {}): NfseEmitirRequest {
  return {
    prestador: {
      cnpj: '12.345.678/0001-90',
      inscricaoMunicipal: '12345',
      nome: 'Prestador Teste',
      endereco: {
        logradouro: 'Rua Teste',
        numero: '100',
        bairro: 'Centro',
        codigoMunicipio: '4207601',
        uf: 'SC',
        cep: '99890-000',
      },
      optanteSimplesNacional: true,
      regApTribSN: 2,
      regEspTrib: 6,
    },
    tomador: {
      cnpj: '98.765.432/0001-10',
      nome: 'Tomador Teste Ltda',
      endereco: {
        logradouro: 'Avenida Principal',
        numero: '200',
        bairro: 'Jardins',
        codigoMunicipio: '3550308',
        uf: 'SP',
        cep: '01310-100',
      },
    },
    servico: {
      codigoServico: '01.07',
      codigoTributacaoNacional: '010700',
      discriminacao: 'Prestação de serviços de tecnologia',
      codigoMunicipioPrestacao: '4207601',
      idTribMun: '1',
    },
    valores: {
      valorServicos: 1000.00,
      aliquotaIss: 0.05,
      issRetido: false,
      exigibilidadeIss: '1',
    },
    rps: {
      numero: 67,
      serie: 'A',      // alfanumérico → deve virar "1"
      tipo: '1',
      dataEmissao: '2026-04-13',
      naturezaOperacao: '1',
    },
    certificado: { pfxBase64: 'mock', password: 'mock' },
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('buildDpsXml — estrutura geral', () => {
  it('produz string XML não vazia', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toBeTruthy();
    expect(xml.length).toBeGreaterThan(100);
  });

  it('contém declaração XML UTF-8', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toMatch(/^<\?xml.*encoding="UTF-8"/);
  });

  it('namespace do Padrão Nacional está presente', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('http://www.sped.fazenda.gov.br/nfse');
  });

  it('versao="1.00" no elemento <DPS>', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('versao="1.00"');
  });
});

describe('buildDpsXml — TSIdDPS (formato do Id)', () => {
  it('Id da infDPS tem exatamente 45 caracteres', () => {
    const xml = buildDpsXml(makeRequest());
    const match = xml.match(/Id="([^"]+)"/);
    expect(match).toBeTruthy();
    expect(match![1]).toHaveLength(45);
  });

  it('Id começa com "DPS"', () => {
    const xml = buildDpsXml(makeRequest());
    const match = xml.match(/Id="([^"]+)"/);
    expect(match![1]).toMatch(/^DPS/);
  });

  it('Id contém cLocEmi (7 dígitos) após "DPS"', () => {
    const xml = buildDpsXml(makeRequest());
    const match = xml.match(/Id="([^"]+)"/);
    const id = match![1];
    // DPS(3) + cLocEmi(7) = posição 3..9
    expect(id.substring(3, 10)).toBe('4207601');
  });

  it('Id contém tpInsc=2 (CNPJ) na posição 10', () => {
    const xml = buildDpsXml(makeRequest());
    const id = xml.match(/Id="([^"]+)"/)![1];
    expect(id[10]).toBe('2');
  });

  it('Id contém CNPJ (14 dígitos) nas posições 11..24', () => {
    const xml = buildDpsXml(makeRequest());
    const id = xml.match(/Id="([^"]+)"/)![1];
    expect(id.substring(11, 25)).toBe('12345678000190');
  });

  it('Id contém série convertida para numérica nas posições 25..29', () => {
    // série "A" → "1" → padStart(5) = "00001"
    const xml = buildDpsXml(makeRequest());
    const id = xml.match(/Id="([^"]+)"/)![1];
    expect(id.substring(25, 30)).toBe('00001');
  });

  it('Id contém nDPS padded para 15 dígitos no final', () => {
    const xml = buildDpsXml(makeRequest());
    const id = xml.match(/Id="([^"]+)"/)![1];
    expect(id.substring(30)).toBe('000000000000067');
  });
});

describe('buildDpsXml — dhEmi (formato de data)', () => {
  it('dhEmi não contém milissegundos', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).not.toMatch(/<dhEmi>[^<]*\.\d{3}/);
  });

  it('dhEmi não termina em "Z"', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).not.toMatch(/<dhEmi>[^<]*Z<\/dhEmi>/);
  });

  it('dhEmi contém offset timezone explícito', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toMatch(/<dhEmi>[^<]+-\d{2}:\d{2}<\/dhEmi>/);
  });
});

describe('buildDpsXml — série alfanumérica', () => {
  it('série "A" é convertida para "1"', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<serie>1</serie>');
    expect(xml).not.toContain('<serie>A</serie>');
  });

  it('série "NFS" é convertida para "1"', () => {
    const req = makeRequest();
    req.rps.serie = 'NFS';
    const xml = buildDpsXml(req);
    expect(xml).toContain('<serie>1</serie>');
  });

  it('série "3" permanece "3" (já numérica)', () => {
    const req = makeRequest();
    req.rps.serie = '3';
    const xml = buildDpsXml(req);
    expect(xml).toContain('<serie>3</serie>');
  });
});

describe('buildDpsXml — Simples Nacional', () => {
  it('opSimpNac=1 quando optanteSimplesNacional=true', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<opSimpNac>1</opSimpNac>');
  });

  it('contém regApTribSN quando fornecido', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<regApTribSN>2</regApTribSN>');
  });

  it('tribMun NÃO contém <pAliq> no Simples Nacional', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).not.toContain('<pAliq>');
  });

  it('tribMun contém <tribISSQN> e <tpRetISSQN>', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<tribISSQN>');
    expect(xml).toContain('<tpRetISSQN>');
  });

  it('totTrib usa <pTotTribSN> (não <vTotTrib>) no SN', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<pTotTribSN>');
    expect(xml).not.toContain('<vTotTrib>');
  });

  it('pTotTribSN tem exatamente 2 casas decimais (TSDec2V2)', () => {
    const xml = buildDpsXml(makeRequest());
    const match = xml.match(/<pTotTribSN>([^<]+)<\/pTotTribSN>/);
    expect(match).toBeTruthy();
    expect(match![1]).toMatch(/^\d+\.\d{2}$/);
  });

  it('pTotTribSN = 5.00 para alíquota 5%', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<pTotTribSN>5.00</pTotTribSN>');
  });
});

describe('buildDpsXml — Regime Normal', () => {
  function makeNormal(): NfseEmitirRequest {
    const req = makeRequest();
    req.prestador.optanteSimplesNacional = false;
    req.prestador.regEspTrib = 0;
    return req;
  }

  it('opSimpNac=2 quando optanteSimplesNacional=false', () => {
    const xml = buildDpsXml(makeNormal());
    expect(xml).toContain('<opSimpNac>2</opSimpNac>');
  });

  it('NÃO contém regApTribSN no regime normal', () => {
    const xml = buildDpsXml(makeNormal());
    expect(xml).not.toContain('<regApTribSN>');
  });

  it('tribMun contém <pAliq> no regime normal', () => {
    const xml = buildDpsXml(makeNormal());
    expect(xml).toContain('<pAliq>');
  });

  it('totTrib usa SÓ <indTotTrib> no regime normal (choice do XSD)', () => {
    // vTotTrib simples + indTotTrib juntos violava o schema; vTotTrib é o
    // total aproximado de tributos (Lei 12.741), não o ISS.
    const xml = buildDpsXml(makeNormal());
    expect(xml).toContain('<indTotTrib>0</indTotTrib>');
    expect(xml).not.toContain('<vTotTrib>');
    expect(xml).not.toContain('<pTotTribSN>');
  });
});

describe('buildDpsXml — endereço do tomador', () => {
  it('<endNac> aparece ANTES de <xLgr> (ordem do XSD)', () => {
    const xml = buildDpsXml(makeRequest());
    const posEndNac = xml.indexOf('<endNac>');
    const posXLgr   = xml.indexOf('<xLgr>');
    expect(posEndNac).toBeGreaterThan(0);
    expect(posXLgr).toBeGreaterThan(posEndNac);
  });

  it('<endNac> contém <cMun> e <CEP>', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<cMun>3550308</cMun>');
    expect(xml).toContain('<CEP>01310100</CEP>');
  });

  it('CEP não contém traço', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).not.toMatch(/<CEP>\d{5}-\d{3}<\/CEP>/);
  });

  it('<xLgr>, <nro> e <xBairro> estão presentes', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<xLgr>');
    expect(xml).toContain('<nro>');
    expect(xml).toContain('<xBairro>');
  });

  it('<xCpl> omitido quando complemento não informado', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).not.toContain('<xCpl>');
  });

  it('<xCpl> incluído quando complemento informado', () => {
    const req = makeRequest();
    req.tomador.endereco!.complemento = 'Sala 101';
    const xml = buildDpsXml(req);
    expect(xml).toContain('<xCpl>Sala 101</xCpl>');
  });

  it('omite <end> completamente quando tomador sem endereço', () => {
    const req = makeRequest();
    delete req.tomador.endereco;
    const xml = buildDpsXml(req);
    expect(xml).not.toContain('<end>');
  });
});

describe('buildDpsXml — campos de serviço', () => {
  it('cLocEmi igual ao codigoMunicipioPrestacao', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<cLocEmi>4207601</cLocEmi>');
  });

  it('cLocPrestacao igual ao codigoMunicipioPrestacao', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<cLocPrestacao>4207601</cLocPrestacao>');
  });

  it('NÃO inclui <cPaisPrestacao> para serviço nacional', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).not.toContain('<cPaisPrestacao>');
  });

  it('cTribNac está presente', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<cTribNac>010700</cTribNac>');
  });

  it('discriminação aparece em <xDescServ>', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<xDescServ>Prestação de serviços de tecnologia</xDescServ>');
  });
});

describe('buildDpsXml — valores', () => {
  it('vReceb e vServ iguais ao valorServicos', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<vReceb>1000.00</vReceb>');
    expect(xml).toContain('<vServ>1000.00</vServ>');
  });

  // Layout nacional: tpRetISSQN 1=Não Retido, 2=Retido pelo Tomador
  it('tpRetISSQN=1 quando ISS não retido', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<tpRetISSQN>1</tpRetISSQN>');
  });

  it('request.ambiente=producao sobrescreve config (tpAmb=1)', () => {
    // Regressão: emitir() ignorava request.ambiente na escolha do endpoint;
    // este teste pinna que o tpAmb do DPS segue o ambiente DO REQUEST.
    const req = makeRequest();
    req.ambiente = 'producao';
    const xml = buildDpsXml(req);
    expect(xml).toContain('<tpAmb>1</tpAmb>');
  });

  it('tpRetISSQN=2 quando ISS retido', () => {
    const req = makeRequest();
    req.valores.issRetido = true;
    const xml = buildDpsXml(req);
    expect(xml).toContain('<tpRetISSQN>2</tpRetISSQN>');
  });
});

describe('buildDpsXml — identificação do prestador', () => {
  it('CNPJ sem pontuação em <prest>', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<CNPJ>12345678000190</CNPJ>');
    expect(xml).not.toContain('12.345.678/0001-90');
  });

  it('IM do prestador está presente', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<IM>12345</IM>');
  });
});

describe('buildDpsXml — tomador CPF vs CNPJ', () => {
  it('tomador com CNPJ usa <CNPJ> sem pontuação', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<CNPJ>98765432000110</CNPJ>');
  });

  it('tomador com CPF usa <CPF>', () => {
    const req = makeRequest();
    delete req.tomador.cnpj;
    req.tomador.cpf = '123.456.789-09';
    const xml = buildDpsXml(req);
    expect(xml).toContain('<CPF>12345678909</CPF>');
    expect(xml).not.toContain('<CNPJ>987');
  });
});

describe('buildDpsXml — ambiente', () => {
  it('tpAmb=2 em homologação (default do ambiente de teste)', () => {
    const xml = buildDpsXml(makeRequest());
    expect(xml).toContain('<tpAmb>2</tpAmb>');
  });
});
