/**
 * buildNFeXml/buildNFCeSupl — defaults obrigatórios do <det> e urlChave.
 *
 * - cEAN/cEANTrib são obrigatórios no XSD 4.00: omitidos viram 'SEM GTIN'
 *   (rejeição 225 se a tag não existir).
 * - uTrib/qTrib/vUnTrib ausentes espelham uCom/qCom/vUnCom.
 * - Campos texto são truncados nos limites do schema (xNome/natOp 60,
 *   xProd 120, infCpl 5000) em vez de estourar o maxLength.
 * - urlChave: tabela completa das 27 UFs (fonte: nfephp-org/sped-nfe
 *   storage/uri_consulta_nfce.json).
 */
import { describe, it, expect } from 'vitest';
import { buildNFeXml, buildNFCeSupl } from '../../lib/nfe/xml-builder';
import { UF_CODES } from '../../lib/utils';
import type { NFeRequest, NFeItem } from '../../types';

const CHAVE = '35260612345678000195550010000001231100000017';
const CSC = { id: '000001', token: 'A1B2C3D4-E5F6-A7B8-C9D0-E1F2A3B4C5D6' };

function makeItem(overrides: Partial<NFeItem['produto']> = {}): NFeItem {
  return {
    numero: 1,
    produto: {
      codigo: 'P001',
      cEAN: 'SEM GTIN',
      descricao: 'PRODUTO TESTE',
      ncm: '21069090',
      cfop: '5102',
      unidade: 'UN',
      quantidade: 2,
      valorUnitario: 50.05,
      valorTotal: 100.1,
      cEANTrib: 'SEM GTIN',
      unidadeTrib: 'UN',
      quantidadeTrib: 2,
      valorUnitarioTrib: 50.05,
      indTot: '1',
      ...overrides,
    },
    imposto: {
      icms: { orig: '0', csosn: '102' },
      pis: { cst: '49' },
      cofins: { cst: '49' },
    },
  };
}

function makeRequest(overrides: Partial<NFeRequest> = {}): NFeRequest {
  return {
    emitente: {
      cnpj: '12345678000195',
      nome: 'EMPRESA TESTE LTDA',
      inscricaoEstadual: '123456789012',
      crt: '1',
      endereco: {
        logradouro: 'RUA TESTE',
        numero: '100',
        bairro: 'CENTRO',
        codigoMunicipio: '3550308',
        municipio: 'SAO PAULO',
        uf: 'SP',
        cep: '01001000',
      },
    },
    destinatario: {
      cpf: '12345678909',
      nome: 'CLIENTE TESTE',
      indicadorIE: '9',
    },
    itens: [makeItem()],
    naturezaOperacao: 'VENDA',
    tipoOperacao: '1',
    finalidade: '1',
    consumidorFinal: '1',
    presencaComprador: '1',
    transporte: { modFrete: '9' },
    pagamento: { indicadorPagamento: '0', formas: [{ tipo: '01', valor: 100.1 }] },
    certificado: { pfxBase64: '', password: '' },
    serie: '1',
    numero: 123,
    ufEmitente: 'SP',
    ...overrides,
  };
}

function build(req: NFeRequest): string {
  return buildNFeXml(req, CHAVE, 123, '1');
}

describe('buildNFeXml — defaults obrigatórios do <det>', () => {
  it('cEAN/cEANTrib omitidos viram SEM GTIN (tag sempre presente)', () => {
    const item = makeItem({ cEAN: undefined as any, cEANTrib: undefined as any });
    const xml = build(makeRequest({ itens: [item] }));

    expect(xml).toContain('<cEAN>SEM GTIN</cEAN>');
    expect(xml).toContain('<cEANTrib>SEM GTIN</cEANTrib>');
  });

  it('cEAN/cEANTrib vazios ou só espaço também viram SEM GTIN', () => {
    const item = makeItem({ cEAN: '', cEANTrib: '   ' });
    const xml = build(makeRequest({ itens: [item] }));

    expect(xml).toContain('<cEAN>SEM GTIN</cEAN>');
    expect(xml).toContain('<cEANTrib>SEM GTIN</cEANTrib>');
  });

  it('GTIN informado é preservado', () => {
    const item = makeItem({ cEAN: '7891234567895', cEANTrib: '7891234567895' });
    const xml = build(makeRequest({ itens: [item] }));

    expect(xml).toContain('<cEAN>7891234567895</cEAN>');
    expect(xml).toContain('<cEANTrib>7891234567895</cEANTrib>');
  });

  it('uTrib/qTrib/vUnTrib ausentes espelham uCom/qCom/vUnCom', () => {
    const item = makeItem({
      unidadeTrib: undefined as any,
      quantidadeTrib: undefined as any,
      valorUnitarioTrib: undefined as any,
    });
    const xml = build(makeRequest({ itens: [item] }));

    expect(xml).toContain('<uTrib>UN</uTrib>');
    expect(xml).toContain('<qTrib>2.0000</qTrib>');
    expect(xml).toContain('<vUnTrib>50.0500000000</vUnTrib>');
  });

  it('unidade tributável distinta informada NÃO é sobrescrita', () => {
    const item = makeItem({ unidadeTrib: 'CX', quantidadeTrib: 1, valorUnitarioTrib: 100.1 });
    const xml = build(makeRequest({ itens: [item] }));

    expect(xml).toContain('<uTrib>CX</uTrib>');
    expect(xml).toContain('<qTrib>1.0000</qTrib>');
    expect(xml).toContain('<vUnTrib>100.1000000000</vUnTrib>');
  });
});

describe('buildNFeXml — truncamento nos limites do schema', () => {
  it('xProd é truncado em 120 chars', () => {
    const item = makeItem({ descricao: 'X'.repeat(150) });
    const xml = build(makeRequest({ itens: [item] }));
    expect(xml).toContain(`<xProd>${'X'.repeat(120)}</xProd>`);
    expect(xml).not.toContain('X'.repeat(121));
  });

  it('natOp e xNome do emitente são truncados em 60 chars', () => {
    const xml = build(makeRequest({
      naturezaOperacao: 'N'.repeat(80),
      emitente: { ...makeRequest().emitente, nome: 'E'.repeat(80) },
    }));
    expect(xml).toContain(`<natOp>${'N'.repeat(60)}</natOp>`);
    expect(xml).toContain(`<xNome>${'E'.repeat(60)}</xNome>`);
  });

  it('infCpl é truncado em 5000 chars', () => {
    const xml = build(makeRequest({
      informacoesAdicionais: { contribuinte: 'C'.repeat(5100) },
    }));
    expect(xml).toContain(`<infCpl>${'C'.repeat(5000)}</infCpl>`);
    expect(xml).not.toContain('C'.repeat(5001));
  });

  it('campo dentro do limite não é alterado', () => {
    const xml = build(makeRequest());
    expect(xml).toContain('<natOp>VENDA</natOp>');
    expect(xml).toContain('<xNome>EMPRESA TESTE LTDA</xNome>');
  });
});

describe('buildNFCeSupl — urlChave por UF (fonte: sped-nfe uri_consulta_nfce.json)', () => {
  function urlChaveDe(supl: string): string {
    const m = supl.match(/<urlChave>([^<]+)<\/urlChave>/);
    expect(m).not.toBeNull();
    return m![1];
  }

  it('PR produção usa a URL de consulta da tabela (não o fallback de QR Code)', () => {
    const supl = buildNFCeSupl(CHAVE, '1', CSC, 'PR');
    expect(urlChaveDe(supl)).toBe('http://www.fazenda.pr.gov.br/nfce/consulta');
  });

  it('MG homologação usa hportalsped', () => {
    const supl = buildNFCeSupl(CHAVE, '2', CSC, 'MG');
    expect(urlChaveDe(supl)).toBe('https://hportalsped.fazenda.mg.gov.br/portalnfce');
  });

  it('GO homologação usa a URL específica de homologação', () => {
    const supl = buildNFCeSupl(CHAVE, '2', CSC, 'GO');
    expect(urlChaveDe(supl)).toBe('www.nfce.go.gov.br/post/ver/214413/consulta-nfc-e-homologacao');
  });

  it('todas as 27 UFs têm urlChave em produção e homologação', () => {
    for (const uf of Object.keys(UF_CODES)) {
      for (const tpAmb of ['1', '2'] as const) {
        const supl = buildNFCeSupl(CHAVE, tpAmb, CSC, uf);
        expect(urlChaveDe(supl).length, `${uf}/${tpAmb}`).toBeGreaterThan(0);
      }
    }
  });

  it('qrCode online segue o leiaute v3 (chNFe|3|tpAmb, sem CSC/hash)', () => {
    const supl = buildNFCeSupl(CHAVE, '1', CSC, 'SP');
    const m = supl.match(/<qrCode>([^<]+)<\/qrCode>/);
    expect(m).not.toBeNull();
    expect(m![1].split('?p=')[1]).toBe(`${CHAVE}|3|1`);
    expect(supl).not.toContain(CSC.token);
  });
});
