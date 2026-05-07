// =====================================================================
// Lightweight types consumed by the SPED EFD-ICMS/IPI generator. Decoupled
// from any storage model — the API converts its Prisma `Invoice` rows into
// these via the adapter in apps/api/src/modules/sped/.
// =====================================================================

export type TaxRegime =
  | 'simples_nacional'
  | 'simples_nacional_excesso'
  | 'lucro_presumido'
  | 'lucro_real';

export interface SpedInvoiceItemTaxes {
  icmsBase?: number;
  icmsRate?: number;
  icmsValue?: number;
  icmsSTBase?: number;
  icmsSTRate?: number;
  icmsSTValue?: number;
  ipiBase?: number;
  ipiRate?: number;
  ipiValue?: number;
  pisBase?: number;
  pisRate?: number;
  pisValue?: number;
  cofinsBase?: number;
  cofinsRate?: number;
  cofinsValue?: number;
}

export interface SpedInvoiceItem {
  code?: string;
  description: string;
  ncm?: string;
  cfop?: string;
  unit?: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  total: number;
  taxes?: SpedInvoiceItemTaxes;
}

export interface SpedInvoiceTaxes {
  icms?: number;
  icmsST?: number;
  ipi?: number;
  pis?: number;
  cofins?: number;
  iss?: number;
  total?: number;
}

export interface SpedInvoiceRecipient {
  type: 'cpf' | 'cnpj' | 'foreign' | 'anonymous';
  document?: string | null;
  name?: string | null;
}

export interface SpedInvoicePaymentMethod {
  type: 'cash' | 'credit' | 'debit' | 'pix' | 'bank_slip' | 'other';
  installments?: number;
  value?: number;
}

export type SpedInvoiceStatus =
  | 'draft'
  | 'pending'
  | 'authorized'
  | 'rejected'
  | 'cancelled';

export interface Invoice {
  type: 'nfe' | 'nfce' | 'nfse' | 'mdfe';
  series?: string;
  number: number;
  accessKey?: string | null;
  status: SpedInvoiceStatus;
  authorizedAt?: Date | string | null;
  createdAt?: Date | string | null;
  recipient?: SpedInvoiceRecipient;
  items: SpedInvoiceItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  taxes?: SpedInvoiceTaxes;
  total: number;
  paymentMethod?: SpedInvoicePaymentMethod;
}

// --- Purchase notes (received NF-e) ---

export interface PurchaseNoteItemTaxes {
  icms?: { baseCalc?: number; value?: number; rate?: number; cst?: string };
  ipi?: { baseCalc?: number; value?: number; rate?: number; cst?: string };
  pis?: { baseCalc?: number; value?: number; rate?: number; cst?: string };
  cofins?: { baseCalc?: number; value?: number; rate?: number; cst?: string };
}

export interface PurchaseNoteItem {
  productCode?: string;
  productName: string;
  ncm?: string;
  cfop?: string;
  unit?: string;
  quantity: number;
  unitPrice?: number;
  totalPrice: number;
  taxes?: PurchaseNoteItemTaxes;
}

export interface PurchaseNoteSupplierAddress {
  cMun?: string;
  xLgr?: string;
  nro?: string;
  xBairro?: string;
}

export interface PurchaseNote {
  supplierCnpj: string;
  supplierName: string;
  supplierAddress?: PurchaseNoteSupplierAddress | null;
  chaveAcesso: string;
  numero: string;
  serie?: string;
  dataEmissao: Date | string;
  valorTotal: number;
  items: PurchaseNoteItem[];
}
