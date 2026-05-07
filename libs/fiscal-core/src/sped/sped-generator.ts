// ===========================================================================
// SPED EFD-ICMS/IPI Generator
// Guia Prático EFD-ICMS/IPI v3.1.9 – COD_VER 015 (Perfis A, B e C)
// Gera arquivo texto para entrega à Receita Federal / Sefaz
// ===========================================================================

import type {
  Invoice,
  PurchaseNote,
  PurchaseNoteItem,
  SpedInvoiceItem,
  TaxRegime,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpedTenant {
  name: string;
  cnpj: string;
  uf: string;
  ie: string;
  im: string;
  codMun: string; // IBGE 7 digits
  taxRegime: TaxRegime;
  /** Perfil explícito (A/B/C). Se omitido, inferido do taxRegime. */
  indPerfil?: 'A' | 'B' | 'C';
  /**
   * Indicador de atividade: '0' = outros, '1' = industrial/equiparado (sujeito ao IPI).
   * Indústrias e equiparados devem usar '1'. Default: '1'.
   */
  indAtiv?: '0' | '1';
  fantasia?: string;
  cep?: string;
  end?: string;
  num?: string;
  bairro?: string;
  fone?: string;
  email?: string;
}

export interface SpedInput {
  tenant: SpedTenant;
  period: { year: number; month: number };
  invoices: Invoice[];
  purchaseNotes: PurchaseNote[];
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format decimal as Brazilian: 1234.56 → "1234,56" */
function fv(n: number | null | undefined): string {
  return ((n ?? 0) === 0 ? '0,00' : (n as number).toFixed(2).replace('.', ','));
}

/** Format date: Date/string → "DDMMYYYY" */
function fd(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d) : d;
  return (
    String(date.getUTCDate()).padStart(2, '0') +
    String(date.getUTCMonth() + 1).padStart(2, '0') +
    String(date.getUTCFullYear())
  );
}

/** Strip non-digits from CNPJ/CPF */
function dg(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

/** Build a SPED record line with CRLF */
function r(...fields: (string | number | null | undefined)[]): string {
  return '|' + fields.map(f => (f === null || f === undefined) ? '' : String(f)).join('|') + '|\r\n';
}

/** Truncate and uppercase string */
function str(s: string | null | undefined, max = 60): string {
  return ((s ?? '').toUpperCase().substring(0, max));
}

// ---------------------------------------------------------------------------
// Tax regime helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a versão do leiaute EFD-ICMS/IPI com base no ano do período:
 *  020 → Guia Prático 3.2.2, Ato COTEPE/ICMS 79/2025, vigente 01/01/2026
 *  019 → Guia Prático 3.1.x, NT 2024.001, vigente 01/01/2025 a 31/12/2025
 *  015 → Guia Prático 3.1.9, vigente 01/01/2024 a 31/12/2024
 */
function resolveLayoutVersion(year: number): string {
  if (year >= 2026) return '020';
  if (year >= 2025) return '019';
  return '015';
}

/**
 * Resolve o perfil SPED:
 *  C = Simples Nacional (todas as modalidades)
 *  B = Lucro Presumido/Real sem substituição tributária interestadual complexa
 *  A = Lucro Presumido/Real com operações interestaduais ou ST (padrão seguro)
 *
 * Se o tenant informar um perfil explícito, este é usado sem inferência.
 */
function resolveIndPerfil(tenant: SpedTenant): string {
  if (tenant.indPerfil) return tenant.indPerfil;
  if (tenant.taxRegime === 'simples_nacional' || tenant.taxRegime === 'simples_nacional_excesso') return 'C';
  // Lucro Presumido ou Real sem perfil explícito → A (mais conservador)
  return 'A';
}

/** Infer ICMS CST/CSOSN from item taxes and regime */
function inferCstIcms(icmsVal: number, taxRegime: TaxRegime): string {
  const isSimples = taxRegime === 'simples_nacional' || taxRegime === 'simples_nacional_excesso';
  if (isSimples) {
    return icmsVal > 0 ? '102' : '400'; // 102=tributado sem permissão de crédito, 400=não tributado
  }
  return icmsVal > 0 ? '000' : '040'; // 000=tributado integral, 040=isento
}

function inferCstPis(pisVal: number): string {
  return pisVal > 0 ? '01' : '07'; // 01=alíquota básica, 07=operações sem incidência
}

function inferCstCofins(cofinsVal: number): string {
  return cofinsVal > 0 ? '01' : '07';
}

function inferCstIpi(ipiVal: number): string {
  return ipiVal > 0 ? '50' : '99'; // 50=saída tributada, 99=outras
}

/** Converte CFOP de saída do fornecedor (5xxx/6xxx) para CFOP de entrada do comprador (1xxx/2xxx) */
function normalizeCfopForEntry(cfop: string): string {
  if (cfop.startsWith('5')) return '1' + cfop.slice(1);
  if (cfop.startsWith('6')) return '2' + cfop.slice(1);
  return cfop;
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildBlock0(
  tenant: SpedTenant,
  dtIni: Date,
  dtFin: Date,
  year: number,
  participants: Map<string, { nome: string; doc: string; codMun?: string; end?: string; nro?: string; bairro?: string }>,
  unitSet: Set<string>,
  itemMap: Map<string, { code: string; desc: string; unit: string; ncm: string }>,
): string[] {
  const lines: string[] = [];

  // Registro 0000 — 15 campos (REG + campos 2–15)
  // Campo 02: COD_VER   — versão do leiaute (resolveLayoutVersion)
  // Campo 03: COD_FIN   — finalidade: 0=original, 1=substituto
  // Campo 04: DT_INI
  // Campo 05: DT_FIN
  // Campo 06: NOME
  // Campo 07: CNPJ
  // Campo 08: CPF
  // Campo 09: UF
  // Campo 10: IE
  // Campo 11: COD_MUN
  // Campo 12: IM
  // Campo 13: SUFRAMA
  // Campo 14: IND_PERFIL (A/B/C)
  // Campo 15: IND_ATIV   — 0=outros, 1=industrial/equiparado
  lines.push(r('0000',
    resolveLayoutVersion(year),             // 02: COD_VER
    '0',                                // 03: COD_FIN (0=original)
    fd(dtIni), fd(dtFin),               // 04, 05: DT_INI, DT_FIN
    str(tenant.name, 100),              // 06: NOME
    dg(tenant.cnpj),                    // 07: CNPJ
    '',                                 // 08: CPF (vazio para PJ)
    tenant.uf.toUpperCase(),            // 09: UF
    tenant.ie || '',                    // 10: IE
    tenant.codMun || '',                // 11: COD_MUN
    tenant.im || '',                    // 12: IM
    '',                                 // 13: SUFRAMA
    resolveIndPerfil(tenant),           // 14: IND_PERFIL
    tenant.indAtiv ?? '1',             // 15: IND_ATIV (1=industrial, padrão para indústria)
  ));

  lines.push(r('0001', '0'));

  // 0005 – Dados Complementares da Entidade (REG + 9 campos = 10 total, sem COD_MUN_SPED)
  lines.push(r('0005',
    str(tenant.fantasia || tenant.name, 60), // 02: FANTASIA
    tenant.cep   || '',                       // 03: CEP
    tenant.end   || '',                       // 04: END
    tenant.num   || '',                       // 05: NUM
    '',                                       // 06: COMPL
    tenant.bairro || '',                      // 07: BAIRRO
    tenant.fone  || '',                       // 08: FONE
    '',                                       // 09: FAX
    tenant.email || '',                       // 10: EMAIL
  ));

  // 0100 – Dados do Contabilista: REG + 13 campos = 14 total
  // CRC, NOME, CPF, TEL, FAX, EMAIL, COD_MUN, CNPJ, CEP, END, NUM, COMPL, BAIRRO
  lines.push(r('0100', '', '', '', '', '', '', '', '', '', '', '', '', ''));

  // 0150 – Participantes (13 campos: COD_PART, NOME, COD_PAIS, CNPJ, CPF, IE, COD_MUN, SUFRAMA, END, NUM, COMPL, BAIRRO)
  // ATENÇÃO: não há campo IND_CRED ou qualquer numérico entre COD_PART e NOME.
  for (const [doc, p] of participants) {
    const isCnpj = doc.length === 14;
    const isCpf  = doc.length === 11;
    lines.push(r('0150',
      doc,                        // 02: COD_PART
      str(p.nome, 100),           // 03: NOME
      '1058',                     // 04: COD_PAIS (1058 = Brasil)
      isCnpj ? doc : '',          // 05: CNPJ (apenas se 14 dígitos)
      isCpf  ? doc : '',          // 06: CPF  (apenas se 11 dígitos)
      '',                         // 07: IE
      p.codMun || '',             // 08: COD_MUN (código IBGE 7 dígitos)
      '',                         // 09: SUFRAMA
      str(p.end || '', 60),       // 10: END
      p.nro || '',                // 11: NUM
      '',                         // 12: COMPL
      str(p.bairro || '', 60),    // 13: BAIRRO
    ));
  }

  // 0190 – Unidades de medida
  for (const unit of unitSet) {
    lines.push(r('0190', unit, unit));
  }

  // 0200 – Itens
  for (const [code, item] of itemMap) {
    lines.push(r('0200', code, str(item.desc, 60), '', '', item.unit, '04', item.ncm || '', '', '', '', '', ''));
  }

  // 0990 – Encerramento bloco 0 (conta a si mesmo)
  lines.push(r('0990', String(lines.length + 1)));

  return lines;
}

function buildBlockC(
  invoices: Invoice[],
  purchaseNotes: PurchaseNote[],
  taxRegime: TaxRegime,
): string[] {
  const lines: string[] = [];
  // Perfil C (Simples Nacional) não gera C170 em nenhum tipo de documento
  const isPerfilC = taxRegime === 'simples_nacional' || taxRegime === 'simples_nacional_excesso';

  lines.push(r('C001', '0'));

  // ---- NF-e / NFC-e emitidas (saídas) ----
  for (const inv of invoices) {
    const codMod = inv.type === 'nfce' ? '65' : '55';
    const isNfce = codMod === '65';
    const codSit = inv.status === 'cancelled' ? '02' : '00';
    // NFC-e (consumidor final): COD_PART deve ficar vazio conforme leiaute SPED
    const partCode = isNfce ? '' : (dg(inv.recipient?.document) || 'ANONIMO');
    const issuedAt = inv.authorizedAt
      ? (typeof inv.authorizedAt === 'object' && 'toDate' in inv.authorizedAt
          ? (inv.authorizedAt as { toDate(): Date }).toDate()
          : new Date(inv.authorizedAt as unknown as string))
      : inv.createdAt
        ? (typeof inv.createdAt === 'object' && 'toDate' in inv.createdAt
            ? (inv.createdAt as { toDate(): Date }).toDate()
            : new Date(inv.createdAt as unknown as string))
        : new Date();

    const indPgto = (() => {
      const pm = inv.paymentMethod?.type;
      if (pm === 'cash' || pm === 'pix' || pm === 'debit') return '0';
      if (pm === 'credit' && (inv.paymentMethod?.installments ?? 1) <= 1) return '0';
      if (pm === 'bank_slip') return '1';
      return '2';
    })();

    // VL_BC_ICMS_ST: soma das bases por item (campo distinto de VL_ICMS_ST)
    const vlBcIcmsST = (inv.items ?? []).reduce(
      (s: number, i: SpedInvoiceItem) => s + (i.taxes?.icmsSTBase ?? 0),
      0,
    );

    // C100
    lines.push(r('C100',
      '1',                          // IND_OPER: 1=saída
      '0',                          // IND_EMIT: 0=emissão própria
      partCode,                     // COD_PART
      codMod,                       // COD_MOD: 55=NF-e, 65=NFC-e
      codSit,                       // COD_SIT: 00=normal, 02=cancelado
      inv.series || '1',            // SER
      String(inv.number),           // NUM_DOC
      inv.accessKey || '',          // CHV_NFE
      fd(issuedAt),                 // DT_DOC
      fd(issuedAt),                 // DT_ES_SAI
      fv(inv.total),                // VL_DOC
      indPgto,                      // IND_PGTO
      fv(inv.discount),             // VL_DESC
      '0,00',                       // VL_ABAT_NT
      fv(inv.subtotal),             // VL_MERC
      inv.shipping > 0 ? '0' : '9',// IND_FRT
      fv(inv.shipping),             // VL_FRT
      '0,00',                       // VL_SEG
      '0,00',                       // VL_OUT_DA
      fv(
        (inv.taxes?.icms ?? 0) > 0
          ? inv.items?.reduce(
              (s: number, i: SpedInvoiceItem) => s + (i.taxes?.icmsBase ?? 0),
              0,
            )
          : 0,
      ), // VL_BC_ICMS
      fv(inv.taxes?.icms),          // VL_ICMS
      isNfce ? '' : fv(vlBcIcmsST),        // VL_BC_ICMS_ST (proibido para NFC-e)
      isNfce ? '' : fv(inv.taxes?.icmsST), // VL_ICMS_ST
      isNfce ? '' : fv(inv.taxes?.ipi),    // VL_IPI
      isNfce ? '' : fv(inv.taxes?.pis),    // VL_PIS
      isNfce ? '' : fv(inv.taxes?.cofins), // VL_COFINS
      isNfce ? '' : '0,00',                // VL_PIS_ST
      isNfce ? '' : '0,00',                // VL_COFINS_ST
    ));

    // C170 – Itens
    let itemNum = 0;
    const c190Groups = new Map<string, { vl: number; bc: number; icms: number; ipi: number }>();

    for (const item of (inv.items ?? [])) {
      itemNum++;
      const t: NonNullable<SpedInvoiceItem['taxes']> = item.taxes ?? {};
      const cstIcms = inferCstIcms(t.icmsValue ?? 0, taxRegime);
      const cstPis = inferCstPis(t.pisValue ?? 0);
      const cstCofins = inferCstCofins(t.cofinsValue ?? 0);
      const cstIpi = inferCstIpi(t.ipiValue ?? 0);

      // C170: proibido para NFC-e (65) e para Perfil C (Simples Nacional) em qualquer doc
      if (codMod !== '65' && !isPerfilC) {
        lines.push(r('C170',
          String(itemNum),            // NUM_ITEM
          item.code || String(itemNum), // COD_ITEM
          '',                         // DESCR_COMPL
          fv(item.quantity),          // QTD
          str(item.unit || 'UN', 6),  // UNID
          fv(item.total),             // VL_ITEM
          fv(item.discount),          // VL_DESC
          '0',                        // IND_MOV: 0=movimenta estoque
          cstIcms,                    // CST_ICMS
          item.cfop || '5102',        // CFOP (fallback: saída de mercadoria adquirida de terceiros)
          '',                         // COD_NAT
          fv(t.icmsBase),             // VL_BC_ICMS
          fv(t.icmsRate),             // ALIQ_ICMS
          fv(t.icmsValue),            // VL_ICMS
          fv(t.icmsSTBase),           // VL_BC_ICMS_ST
          fv(t.icmsSTRate),           // ALIQ_ST
          fv(t.icmsSTValue),          // VL_ICMS_ST
          '',                         // IND_APUR
          cstIpi,                     // CST_IPI
          '',                         // COD_ENQ
          fv(t.ipiBase),              // VL_BC_IPI
          fv(t.ipiRate),              // ALIQ_IPI
          fv(t.ipiValue),             // VL_IPI
          cstPis,                     // CST_PIS
          fv(t.pisBase),              // VL_BC_PIS
          fv(t.pisRate),              // ALIQ_PIS
          '',                         // QUANT_BC_PIS
          '',                         // ALIQ_PIS_R
          fv(t.pisValue),             // VL_PIS
          cstCofins,                  // CST_COFINS
          fv(t.cofinsBase),           // VL_BC_COFINS
          fv(t.cofinsRate),           // ALIQ_COFINS
          '',                         // QUANT_BC_COFINS
          '',                         // ALIQ_COFINS_R
          fv(t.cofinsValue),          // VL_COFINS
          '',                         // COD_CTA
          '0,00',                     // VL_ABAT_NT (campo 38, leiaute ≥018)
        ));
      }

      // Aggregate for C190 (sempre, independente de NF-e ou NFC-e)
      const key = `${cstIcms}|${item.cfop || '5102'}|${fv(t.icmsRate)}`;
      const g = c190Groups.get(key) ?? { vl: 0, bc: 0, icms: 0, ipi: 0 };
      g.vl  += item.total ?? 0;
      g.bc  += t.icmsBase ?? 0;
      g.icms += t.icmsValue ?? 0;
      g.ipi += t.ipiValue ?? 0;
      c190Groups.set(key, g);
    }

    // C190 – Analítico por CST/CFOP/Alíquota (12 campos — leiaute 020)
    for (const [key, g] of c190Groups) {
      const [cst, cfop, aliq] = key.split('|');
      lines.push(r('C190',
        cst,          // CST_ICMS
        cfop,         // CFOP
        aliq,         // ALIQ_ICMS
        fv(g.vl),     // VL_OPR
        fv(g.bc),     // VL_BC_ICMS
        fv(g.icms),   // VL_ICMS
        '0,00',       // VL_BC_ICMS_ST
        '0,00',       // VL_ICMS_ST
        '0,00',       // VL_RED_BC
        fv(g.ipi),    // VL_IPI (campo 11, adicionado leiaute ≥018)
        '',            // COD_OBS
      ));
    }
  }

  // ---- NF-e recebidas (entradas / compras) ----
  for (const note of purchaseNotes) {
    const supplierCode = dg(note.supplierCnpj);
    const issuedDate = note.dataEmissao || new Date();

    const totalIcmsBc  = (note.items ?? []).reduce((s: number, i: PurchaseNoteItem) => s + (i.taxes?.icms?.baseCalc ?? 0), 0);
    const totalIcms    = (note.items ?? []).reduce((s: number, i: PurchaseNoteItem) => s + (i.taxes?.icms?.value    ?? 0), 0);
    const totalIpi     = (note.items ?? []).reduce((s: number, i: PurchaseNoteItem) => s + (i.taxes?.ipi?.value     ?? 0), 0);
    const totalPis     = (note.items ?? []).reduce((s: number, i: PurchaseNoteItem) => s + (i.taxes?.pis?.value     ?? 0), 0);
    const totalCofins  = (note.items ?? []).reduce((s, i) => s + (i.taxes?.cofins?.value  ?? 0), 0);

    lines.push(r('C100',
      '0',                          // IND_OPER: 0=entrada
      '1',                          // IND_EMIT: 1=terceiros
      supplierCode,                 // COD_PART
      '55',                         // COD_MOD: NF-e
      '00',                         // COD_SIT: normal
      note.serie || '1',            // SER
      note.numero,                  // NUM_DOC
      note.chaveAcesso || '',       // CHV_NFE
      fd(issuedDate),               // DT_DOC
      fd(issuedDate),               // DT_ES_SAI
      fv(note.valorTotal),          // VL_DOC
      '2',                          // IND_PGTO: outros
      '0,00',                       // VL_DESC
      '0,00',                       // VL_ABAT_NT
      fv(note.valorTotal),          // VL_MERC
      '9',                          // IND_FRT: sem frete
      '0,00',                       // VL_FRT
      '0,00',                       // VL_SEG
      '0,00',                       // VL_OUT_DA
      fv(totalIcmsBc),              // VL_BC_ICMS
      fv(totalIcms),                // VL_ICMS
      '0,00',                       // VL_BC_ICMS_ST
      '0,00',                       // VL_ICMS_ST
      fv(totalIpi),                 // VL_IPI
      fv(totalPis),                 // VL_PIS
      fv(totalCofins),              // VL_COFINS
      '0,00',                       // VL_PIS_ST
      '0,00',                       // VL_COFINS_ST
    ));

    // C170 for purchase items — omitido para Perfil C (Simples Nacional)
    let itemNum = 0;
    if (!isPerfilC) {
      for (const item of (note.items ?? [])) {
        itemNum++;
        const it = item.taxes ?? {};
        const icmsVal  = it.icms?.value  ?? 0;
        const ipiVal   = it.ipi?.value   ?? 0;
        const pisVal   = it.pis?.value   ?? 0;
        const cofinsVal = it.cofins?.value ?? 0;
        const cstIcms  = it.icms?.cst  ?? inferCstIcms(icmsVal, taxRegime);
        const cstIpi   = it.ipi?.cst   ?? inferCstIpi(ipiVal);
        const cstPis   = it.pis?.cst   ?? inferCstPis(pisVal);
        const cstCofins = it.cofins?.cst ?? inferCstCofins(cofinsVal);
        const cfop = normalizeCfopForEntry(item.cfop || '1102');
        lines.push(r('C170',
          String(itemNum),
          item.productCode || String(itemNum),
          '',
          fv(item.quantity),
          str(item.unit || 'UN', 6),
          fv(item.totalPrice),
          '0,00',
          '0',
          cstIcms,
          cfop,
          '',
          fv(it.icms?.baseCalc), fv(it.icms?.rate), fv(icmsVal),   // VL_BC_ICMS, ALIQ_ICMS, VL_ICMS
          '0,00', '0,00', '0,00',                                   // ICMS ST
          '', cstIpi, '',                                            // IND_APUR, CST_IPI, COD_ENQ
          fv(it.ipi?.baseCalc), fv(it.ipi?.rate), fv(ipiVal),      // VL_BC_IPI, ALIQ_IPI, VL_IPI
          cstPis,
          fv(it.pis?.baseCalc), fv(it.pis?.rate), '', '', fv(pisVal),     // PIS fields
          cstCofins,
          fv(it.cofins?.baseCalc), fv(it.cofins?.rate), '', '', fv(cofinsVal), // COFINS fields
          '',       // COD_CTA
          '0,00',   // VL_ABAT_NT (campo 38, leiaute ≥018)
        ));
      }
    }

    // C190 for purchase — grouped by CST/CFOP/Alíquota using real item tax data
    const c190PurchaseGroups = new Map<string, { vl: number; bc: number; icms: number; ipi: number }>();
    for (const item of (note.items ?? [])) {
      const it = item.taxes ?? {};
      const icmsVal = it.icms?.value ?? 0;
      // Perfil C: sempre usar CSOSN inferido (3 dígitos); CST do fornecedor é 2 dígitos e causa
      // "tamanho de campo inválido" no validador SPED quando a empresa é Simples Nacional.
      const cst = isPerfilC ? inferCstIcms(icmsVal, taxRegime) : (it.icms?.cst ?? inferCstIcms(icmsVal, taxRegime));
      const cfop = normalizeCfopForEntry(item.cfop || '1102');
      const aliq = fv(it.icms?.rate);
      const key = `${cst}|${cfop}|${aliq}`;
      const g = c190PurchaseGroups.get(key) ?? { vl: 0, bc: 0, icms: 0, ipi: 0 };
      g.vl   += item.totalPrice ?? 0;
      g.bc   += it.icms?.baseCalc ?? 0;
      g.icms += icmsVal;
      g.ipi  += it.ipi?.value ?? 0;
      c190PurchaseGroups.set(key, g);
    }
    for (const [key, g] of c190PurchaseGroups) {
      const [cst, cfop, aliq] = key.split('|');
      lines.push(r('C190',
        cst, cfop, aliq,
        fv(g.vl), fv(g.bc), fv(g.icms),
        '0,00', '0,00', '0,00',
        fv(g.ipi), // VL_IPI (campo 11, leiaute ≥018)
        '',         // COD_OBS
      ));
    }
  }

  // C990
  lines.push(r('C990', String(lines.length + 1)));

  return lines;
}

function buildBlockA(): string[] {
  return [r('A001', '1'), r('A990', '2')];
}

function buildBlockB(): string[] {
  return [r('B001', '1'), r('B990', '2')];
}

function buildBlockD(): string[] {
  return [r('D001', '1'), r('D990', '2')];
}

function buildBlockE(dtIni: Date, dtFin: Date, isPerfilC: boolean): string[] {
  const lines: string[] = [];
  lines.push(r('E001', '0'));
  lines.push(r('E100', fd(dtIni), fd(dtFin)));
  // E110 obrigatório para todos os perfis (inclusive Perfil C / Simples Nacional)
  lines.push(r('E110',
    '0,00', '0,00', '0,00', '0,00', '0,00',
    '0,00', '0,00', '0,00', '0,00', '0,00',
    '0,00', '0,00', '0,00', '0,00',
  ));
  lines.push(r('E990', String(lines.length + 1)));
  return lines;
}

function buildBlockG(): string[] {
  return [r('G001', '1'), r('G990', '2')];
}

function buildBlockH(): string[] {
  return [r('H001', '1'), r('H990', '2')];
}

function buildBlockK(): string[] {
  return [r('K001', '1'), r('K990', '2')];
}

function buildBlock1(): string[] {
  const lines: string[] = [];
  lines.push(r('1001', '0'));
  // 1010: leiaute ≥020 (2026) — REG + 13 indicadores = 14 campos total.
  // DT_INI/DT_FIN removidos; valor inativo = '' (vazio), não '0'.
  lines.push(r('1010',
    '',  // 02: IND_EXP
    '',  // 03: IND_CCRF
    '',  // 04: IND_COMB
    '',  // 05: IND_USINA
    '',  // 06: IND_VA
    '',  // 07: IND_EE
    '',  // 08: IND_CART
    '',  // 09: IND_FORM
    '',  // 10: IND_AER
    '',  // 11: IND_GIAF1
    '',  // 12: IND_GIAF3
    '',  // 13: IND_GIAF4
    '',  // 14: IND_REST_RES_SARC_COMPL_ICMS
  ));
  lines.push(r('1990', String(lines.length + 1)));
  return lines;
}

function buildBlock9(allBlockLines: string[][]): string[] {
  const regCounts = new Map<string, number>();

  for (const block of allBlockLines) {
    for (const line of block) {
      const m = line.match(/^\|([A-Z0-9]+)\|/);
      if (m) {
        const reg = m[1];
        regCounts.set(reg, (regCounts.get(reg) ?? 0) + 1);
      }
    }
  }

  const lines: string[] = [];
  lines.push(r('9001', '0'));

  // 9900 for each register seen so far (not counting block 9 records yet)
  for (const [reg, cnt] of regCounts) {
    lines.push(r('9900', reg, String(cnt)));
  }

  // Add 9900 records for block 9 itself.
  // Total 9900 records = loop (regCounts.size) + 4 extra (9900 itself, 9001, 9990, 9999).
  const n9900 = regCounts.size + 4;
  lines.push(r('9900', '9900', String(n9900)));
  lines.push(r('9900', '9001', '1'));
  lines.push(r('9900', '9990', '1'));
  lines.push(r('9900', '9999', '1'));

  // QTD_LIN_9: total de linhas do Bloco 9 incluindo 9990 e 9999 (9999 pertence ao Bloco 9)
  lines.push(r('9990', String(lines.length + 2)));

  return lines;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateSpedEfd(input: SpedInput): string {
  const { tenant, period, invoices, purchaseNotes } = input;
  const { year, month } = period;

  const dtIni = new Date(Date.UTC(year, month - 1, 1));
  const dtFin = new Date(Date.UTC(year, month, 0)); // last day of month

  const isPerfilC = tenant.taxRegime === 'simples_nacional' || tenant.taxRegime === 'simples_nacional_excesso';

  // Collect unique participants
  // NFC-e (65): COD_PART é sempre vazio no C100, portanto não entram no 0150
  const participants = new Map<string, { nome: string; doc: string; codMun?: string; end?: string; nro?: string; bairro?: string }>();
  for (const inv of invoices) {
    if (inv.type === 'nfce') continue;
    if (inv.recipient?.document) {
      const doc = dg(inv.recipient.document);
      if (doc && !participants.has(doc)) {
        participants.set(doc, { nome: inv.recipient.name || 'NAO IDENTIFICADO', doc });
      }
    }
  }
  for (const note of purchaseNotes) {
    const doc = dg(note.supplierCnpj);
    if (doc && !participants.has(doc)) {
      const addr = note.supplierAddress;
      participants.set(doc, {
        nome: note.supplierName,
        doc,
        codMun: addr?.cMun  || '',
        end:    addr?.xLgr  || '',
        nro:    addr?.nro   || '',
        bairro: addr?.xBairro || '',
      });
    }
  }

  // Collect unique items — apenas os que serão referenciados em C170
  // Perfil C: C170 nunca é gerado → 0200 ficaria sem referência → não incluir
  // NFC-e (65): C170 nunca é gerado → mesma razão
  const itemMap = new Map<string, { code: string; desc: string; unit: string; ncm: string }>();
  const unitSet = new Set<string>();

  if (!isPerfilC) {
    for (const inv of invoices) {
      if (inv.type === 'nfce') continue;
      for (const item of (inv.items ?? [])) {
        const unit = (item.unit || 'UN').toUpperCase();
        unitSet.add(unit);
        const key = (item.code || item.description.substring(0, 20)).toUpperCase();
        if (!itemMap.has(key)) {
          itemMap.set(key, { code: key, desc: item.description, unit, ncm: item.ncm || '' });
        }
      }
    }
    for (const note of purchaseNotes) {
      for (const item of (note.items ?? [])) {
        const unit = (item.unit || 'UN').toUpperCase();
        unitSet.add(unit);
        const key = (item.productCode || item.productName.substring(0, 20)).toUpperCase();
        if (!itemMap.has(key)) {
          itemMap.set(key, { code: key, desc: item.productName, unit, ncm: item.ncm || '' });
        }
      }
    }
  }

  const block0 = buildBlock0(tenant, dtIni, dtFin, year, participants, unitSet, itemMap);
  const blockC = buildBlockC(invoices, purchaseNotes, tenant.taxRegime);
  const blockD = buildBlockD();
  const blockE = buildBlockE(dtIni, dtFin, isPerfilC);
  const blockB = buildBlockB();
  const blockG = buildBlockG();
  const blockH = buildBlockH();
  const blockK = buildBlockK();
  const block1 = buildBlock1();
  // Ordem obrigatória: 0, B, C, D, E, G, H, K, 1, 9, 9999
  // Block A (NFS-e modelos 01/1B/04/21) omitido — não é escriturado por Perfil C nem usado
  const allBlocks = [block0, blockB, blockC, blockD, blockE, blockG, blockH, blockK, block1];
  const block9 = buildBlock9(allBlocks);
  allBlocks.push(block9);

  const allLines = allBlocks.flat();
  const totalLines = allLines.length + 1; // +1 for 9999 itself
  const lastLine = r('9999', String(totalLines));

  return allLines.join('') + lastLine;
}
