/**
 * NF-e de devolução (finNFe 4): o ICMS e o ST da compra no CSOSN 900, o FCP do ST, o IPI
 * devolvido (impostoDevol, NT 2016.002) e o vNF que soma os dois; e a validação do ST, que é a
 * base × alíquota MENOS o ICMS próprio.
 */
import { describe, it, expect } from 'vitest';
import { buildNFeXml } from '../../lib/nfe/xml-builder';
import { validateNFePayload } from '../../services/nfe.service';
import type { NFeRequest, NFeItem } from '../../types';

const CHAVE = '35260612345678000195550010000001231100000017';
const ORIGINAL = '35260645543915000181550010000000771000000010';

function itemDevolvido(): NFeItem {
  return {
    numero: 1,
    produto: {
      codigo: 'FER-10',
      cEAN: 'SEM GTIN',
      descricao: 'FERMENTO BIOLOGICO 10G',
      ncm: '21021090',
      cfop: '5411',
      unidade: 'UN',
      quantidade: 12,
      valorUnitario: 1.5,
      valorTotal: 18,
      cEANTrib: 'SEM GTIN',
      unidadeTrib: 'UN',
      quantidadeTrib: 12,
      valorUnitarioTrib: 1.5,
      indTot: '1',
    },
    imposto: {
      icms: {
        orig: '0',
        csosn: '900',
        modBC: '3',
        valorBC: 18,
        aliquota: 12,
        valor: 2.16,
        modBCST: '4',
        mvaST: 40,
        valorBCST: 25.2,
        aliquotaST: 17,
        valorST: 2.12,
        valorBCFCPST: 25.2,
        aliquotaFCPST: 2,
        valorFCPST: 0.5,
      },
      pis: { cst: '49' },
      cofins: { cst: '49' },
    },
    impostoDevol: { percentualDevolvido: 100, valorIPIDevolvido: 1.5 },
  };
}

function devolucao(): NFeRequest {
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
      cnpj: '45543915000181',
      nome: 'ATACADO BETA LTDA',
      indicadorIE: '1',
      inscricaoEstadual: '111222333444',
    },
    itens: [itemDevolvido()],
    naturezaOperacao: 'DEVOLUCAO DE COMPRA PARA COMERCIALIZACAO',
    tipoOperacao: '1',
    finalidade: '4',
    referencias: [{ refNFe: ORIGINAL }],
    consumidorFinal: '0',
    presencaComprador: '0',
    transporte: { modFrete: '9' },
    pagamento: { indicadorPagamento: '0', formas: [{ tipo: '90', valor: 0 }] },
    certificado: { pfxBase64: '', password: '' },
    serie: '1',
    numero: 123,
    ufEmitente: 'SP',
  } as NFeRequest;
}

describe('NF-e de devolução', () => {
  it('o CSOSN 900 leva o ICMS, o ST e o FCP do ST na ordem do XSD', () => {
    const xml = buildNFeXml(devolucao(), CHAVE, 123, '2');
    const grupo = xml.slice(xml.indexOf('<ICMSSN900>'), xml.indexOf('</ICMSSN900>'));
    const ordem = [
      'orig', 'CSOSN', 'modBC', 'vBC', 'pICMS', 'vICMS', 'modBCST', 'pMVAST', 'vBCST',
      'pICMSST', 'vICMSST', 'vBCFCPST', 'pFCPST', 'vFCPST',
    ].map((t) => grupo.indexOf(`<${t}>`));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(grupo).toContain('<pMVAST>40.00</pMVAST>');
    expect(grupo).toContain('<vFCPST>0.50</vFCPST>');
  });

  it('o impostoDevol vem depois do imposto, e o vNF soma o FCP do ST e o IPI devolvido', () => {
    const xml = buildNFeXml(devolucao(), CHAVE, 123, '2');
    expect(xml).toContain(
      '<impostoDevol><pDevol>100.00</pDevol><IPI><vIPIDevol>1.50</vIPIDevol></IPI></impostoDevol>',
    );
    expect(xml.indexOf('</imposto>')).toBeLessThan(xml.indexOf('<impostoDevol>'));
    expect(xml).toContain('<vFCPST>0.50</vFCPST><vFCPSTRet>');
    expect(xml).toContain('<vIPIDevol>1.50</vIPIDevol><vPIS>');
    // 18,00 + ST 2,12 + FCP-ST 0,50 + IPI devolvido 1,50
    expect(xml).toContain('<vNF>22.12</vNF>');
    expect(xml).toContain(`<NFref><refNFe>${ORIGINAL}</refNFe></NFref>`);
    expect(xml).toContain('<finNFe>4</finNFe>');
  });

  it('o ST abaixo da base × alíquota (o ICMS próprio descontado) passa; acima, não', () => {
    expect(validateNFePayload(devolucao())).toEqual([]);
    const acima = devolucao();
    acima.itens[0].imposto.icms.valorST = 4.5;
    expect(validateNFePayload(acima).join(' ')).toContain('maior que a base × alíquota do ST');
  });
});
