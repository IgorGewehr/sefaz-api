import { describe, expect, it } from 'vitest';
import { toSpedInvoice } from '../adapter';

describe('toSpedInvoice', () => {
  const baseRow = {
    type: 'NFE',
    series: 1,
    number: 42,
    accessKey: '35'.padEnd(44, '1'),
    status: 'AUTHORIZED',
    authorizedAt: new Date('2024-11-28T14:32:00Z'),
    cancelledAt: null,
    createdAt: new Date('2024-11-28T14:30:00Z'),
    recipient: { cnpj: '12345678000195', nome: 'Acme Ltda' },
    items: [
      {
        produto: {
          codigo: 'P001',
          descricao: 'Produto X',
          ncm: '84713012',
          cfop: '5102',
          unidade: 'UN',
          quantidade: 2,
          valorUnitario: 50,
          valorTotal: 100,
        },
        imposto: {
          icms: { cst: '00', modBC: '0', valorBC: 100, aliquota: 18, valor: 18 },
          pis: { cst: '01', valorBC: 100, aliquota: 1.65, valor: 1.65 },
          cofins: { cst: '01', valorBC: 100, aliquota: 7.6, valor: 7.6 },
        },
      },
    ],
    totals: { total: 100, discount: 0, shipping: 0 },
    payment: { formas: [{ tipo: '17', valor: 100 }] }, // PIX
  };

  it('flattens NFe row into SPED Invoice shape', () => {
    const out = toSpedInvoice(baseRow);
    expect(out.type).toBe('nfe');
    expect(out.number).toBe(42);
    expect(out.status).toBe('authorized');
    expect(out.recipient).toEqual({
      type: 'cnpj',
      document: '12345678000195',
      name: 'Acme Ltda',
    });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].total).toBe(100);
    expect(out.items[0].taxes?.icmsValue).toBe(18);
    expect(out.taxes?.icms).toBe(18);
    expect(out.paymentMethod?.type).toBe('pix');
  });

  it('falls back to anonymous recipient when neither CNPJ nor CPF', () => {
    const out = toSpedInvoice({ ...baseRow, recipient: {} });
    expect(out.recipient?.type).toBe('anonymous');
  });

  it('maps CANCELLED status correctly', () => {
    const out = toSpedInvoice({ ...baseRow, status: 'CANCELLED' });
    expect(out.status).toBe('cancelled');
  });

  it('handles missing items gracefully', () => {
    const out = toSpedInvoice({ ...baseRow, items: [] });
    expect(out.items).toEqual([]);
    expect(out.subtotal).toBe(0);
  });
});
