import type { Invoice, SpedInvoiceItem } from './types';

interface PrismaInvoiceRow {
  type: string;
  series: number;
  number: number;
  accessKey: string | null;
  status: string;
  authorizedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  recipient: unknown;
  items: unknown;
  totals: unknown;
  payment: unknown;
}

interface RecipientShape {
  cnpj?: string;
  cpf?: string;
  nome?: string;
  email?: string;
}

interface ItemShape {
  produto?: {
    codigo?: string;
    descricao?: string;
    ncm?: string;
    cfop?: string;
    unidade?: string;
    quantidade?: number;
    valorUnitario?: number;
    valorDesconto?: number;
    valorTotal?: number;
  };
  imposto?: {
    icms?: {
      cst?: string;
      csosn?: string;
      modBC?: string;
      valorBC?: number;
      aliquota?: number;
      valor?: number;
      modBCST?: string;
      valorBCST?: number;
      aliquotaST?: number;
      valorST?: number;
    };
    pis?: { cst?: string; valorBC?: number; aliquota?: number; valor?: number };
    cofins?: { cst?: string; valorBC?: number; aliquota?: number; valor?: number };
    ipi?: { cst?: string; valorBC?: number; aliquota?: number; valor?: number };
  };
}

interface PaymentShape {
  formas?: Array<{ tipo?: string; valor?: number }>;
}

/**
 * Convert a Prisma Invoice row into the shape the SPED generator consumes.
 * The translation is loss-tolerant: missing JSON fields fall back to safe
 * defaults so the generator can still emit a valid (possibly thin) record.
 */
export function toSpedInvoice(row: PrismaInvoiceRow): Invoice {
  const recipient = (row.recipient ?? {}) as RecipientShape;
  const itemsRaw = (Array.isArray(row.items) ? row.items : []) as ItemShape[];
  const totals = (row.totals ?? {}) as Record<string, number>;
  const payment = (row.payment ?? {}) as PaymentShape;

  const items: SpedInvoiceItem[] = itemsRaw.map((it) => {
    const p = it.produto ?? {};
    const imp = it.imposto ?? {};
    const total = p.valorTotal ?? (Number(p.quantidade ?? 0) * Number(p.valorUnitario ?? 0));
    return {
      code: p.codigo,
      description: p.descricao ?? '',
      ncm: p.ncm,
      cfop: p.cfop,
      unit: p.unidade,
      quantity: Number(p.quantidade ?? 0),
      unitPrice: p.valorUnitario,
      discount: p.valorDesconto ?? 0,
      total: Number(total),
      taxes: {
        icmsBase: imp.icms?.valorBC,
        icmsRate: imp.icms?.aliquota,
        icmsValue: imp.icms?.valor,
        icmsSTBase: imp.icms?.valorBCST,
        icmsSTRate: imp.icms?.aliquotaST,
        icmsSTValue: imp.icms?.valorST,
        ipiBase: imp.ipi?.valorBC,
        ipiRate: imp.ipi?.aliquota,
        ipiValue: imp.ipi?.valor,
        pisBase: imp.pis?.valorBC,
        pisRate: imp.pis?.aliquota,
        pisValue: imp.pis?.valor,
        cofinsBase: imp.cofins?.valorBC,
        cofinsRate: imp.cofins?.aliquota,
        cofinsValue: imp.cofins?.valor,
      },
    };
  });

  const subtotal = items.reduce((s, i) => s + (i.total ?? 0), 0);
  const total = Number(totals.total ?? subtotal);

  const recipientType: Invoice['recipient'] = (() => {
    if (recipient.cnpj) return { type: 'cnpj', document: recipient.cnpj, name: recipient.nome };
    if (recipient.cpf) return { type: 'cpf', document: recipient.cpf, name: recipient.nome };
    return { type: 'anonymous' };
  })();

  return {
    type: row.type.toLowerCase() as Invoice['type'],
    series: String(row.series),
    number: row.number,
    accessKey: row.accessKey,
    status: mapStatus(row.status),
    authorizedAt: row.authorizedAt,
    createdAt: row.createdAt,
    recipient: recipientType,
    items,
    subtotal,
    discount: Number(totals.discount ?? 0),
    shipping: Number(totals.shipping ?? 0),
    total,
    taxes: {
      icms: items.reduce((s, i) => s + (i.taxes?.icmsValue ?? 0), 0),
      icmsST: items.reduce((s, i) => s + (i.taxes?.icmsSTValue ?? 0), 0),
      ipi: items.reduce((s, i) => s + (i.taxes?.ipiValue ?? 0), 0),
      pis: items.reduce((s, i) => s + (i.taxes?.pisValue ?? 0), 0),
      cofins: items.reduce((s, i) => s + (i.taxes?.cofinsValue ?? 0), 0),
    },
    paymentMethod: payment.formas?.[0]
      ? {
          type: mapPaymentTipo(payment.formas[0].tipo),
          installments: 1,
          value: payment.formas[0].valor,
        }
      : undefined,
  };
}

function mapStatus(s: string): Invoice['status'] {
  switch (s) {
    case 'AUTHORIZED':
      return 'authorized';
    case 'CANCELLED':
      return 'cancelled';
    case 'REJECTED':
    case 'DENIED':
      return 'rejected';
    case 'PENDING':
    case 'PROCESSING':
      return 'pending';
    default:
      return 'draft';
  }
}

function mapPaymentTipo(t: string | undefined): NonNullable<Invoice['paymentMethod']>['type'] {
  switch (t) {
    case '01':
      return 'cash';
    case '03':
      return 'credit';
    case '04':
      return 'debit';
    case '15':
      return 'bank_slip';
    case '17':
      return 'pix';
    default:
      return 'other';
  }
}
