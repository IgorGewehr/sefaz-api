/**
 * Gerador de DANFE (PDF) para NF-e e NFC-e
 * Usa PDFKit para gerar PDFs server-side
 */

import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';

// ============================================================
// Helpers
// ============================================================

function tag(xml: string, name: string): string {
    const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
    return m ? m[1].trim() : '';
}

function tagNum(xml: string, name: string): number {
    const v = tag(xml, name);
    return v ? parseFloat(v) : 0;
}

function fmtCnpj(v: string): string {
    const d = v.replace(/\D/g, '');
    if (d.length !== 14) return v;
    return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}

function fmtCpf(v: string): string {
    const d = v.replace(/\D/g, '');
    if (d.length !== 11) return v;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

function fmtMoney(v: number): string {
    return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChave(chave: string): string {
    return chave.replace(/(.{4})/g, '$1 ').trim();
}

function fmtDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const TPAG_MAP: Record<string, string> = {
    '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão Crédito', '04': 'Cartão Débito',
    '05': 'Crédito Loja', '10': 'Vale Alimentação', '11': 'Vale Refeição',
    '12': 'Vale Presente', '13': 'Vale Combustível', '14': 'Duplicata',
    '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência',
    '90': 'Sem Pagamento', '99': 'Outros',
};

// ============================================================
// Extract data from XML
// ============================================================

interface DanfeData {
    modelo: string;
    chaveAcesso: string;
    numero: string;
    serie: string;
    dataEmissao: string;
    protocolo: string;
    tpAmb: string;
    emitente: {
        cnpj: string;
        nome: string;
        fantasia: string;
        ie: string;
        endereco: string;
        cidade: string;
        uf: string;
        cep: string;
    };
    destinatario?: {
        cpf?: string;
        cnpj?: string;
        nome: string;
    };
    itens: {
        num: number;
        codigo: string;
        descricao: string;
        ncm: string;
        cfop: string;
        un: string;
        qtd: number;
        vUnit: number;
        vTotal: number;
    }[];
    totais: {
        vProd: number;
        vDesc: number;
        vFrete: number;
        vSeg: number;
        vOutro: number;
        vNF: number;
        vBC: number;
        vICMS: number;
        vST: number;
        vIPI: number;
        vPIS: number;
        vCOFINS: number;
    };
    pagamentos: { tipo: string; valor: number }[];
    qrCodeUrl: string;
    urlChave: string;
    infAdic: string;
    natOp: string;
}

function extractDanfeData(xml: string): DanfeData {
    const idMatch = xml.match(/Id="NFe(\d{44})"/);
    const chaveAcesso = idMatch ? idMatch[1] : '';
    const protMatch = xml.match(/<nProt>(\d+)<\/nProt>/);
    const protocolo = protMatch ? protMatch[1] : '';

    // Emitente
    const emitXml = xml.match(/<emit>([\s\S]*?)<\/emit>/)?.[1] || '';
    const enderEmitXml = emitXml.match(/<enderEmit>([\s\S]*?)<\/enderEmit>/)?.[1] || '';

    // Destinatário
    const destXml = xml.match(/<dest>([\s\S]*?)<\/dest>/)?.[1] || '';

    // Items
    const itens: DanfeData['itens'] = [];
    const detRegex = /<det\s+nItem="(\d+)">([\s\S]*?)<\/det>/gi;
    let m;
    while ((m = detRegex.exec(xml)) !== null) {
        const d = m[2];
        itens.push({
            num: parseInt(m[1]),
            codigo: tag(d, 'cProd'),
            descricao: tag(d, 'xProd'),
            ncm: tag(d, 'NCM'),
            cfop: tag(d, 'CFOP'),
            un: tag(d, 'uCom'),
            qtd: tagNum(d, 'qCom'),
            vUnit: tagNum(d, 'vUnCom'),
            vTotal: tagNum(d, 'vProd'),
        });
    }

    // Totais
    const totaisXml = xml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/)?.[1] || '';

    // Pagamentos
    const pagamentos: DanfeData['pagamentos'] = [];
    const detPagRegex = /<detPag>([\s\S]*?)<\/detPag>/gi;
    while ((m = detPagRegex.exec(xml)) !== null) {
        pagamentos.push({
            tipo: tag(m[1], 'tPag'),
            valor: tagNum(m[1], 'vPag'),
        });
    }

    // QR Code
    const qrMatch = xml.match(/<qrCode>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/qrCode>/);
    const qrCodeUrl = qrMatch ? qrMatch[1] : '';
    const urlChave = tag(xml, 'urlChave');

    return {
        modelo: tag(xml, 'mod'),
        chaveAcesso,
        numero: tag(xml, 'nNF'),
        serie: tag(xml, 'serie'),
        dataEmissao: tag(xml, 'dhEmi'),
        protocolo,
        tpAmb: tag(xml, 'tpAmb'),
        emitente: {
            cnpj: tag(emitXml, 'CNPJ'),
            nome: tag(emitXml, 'xNome'),
            fantasia: tag(emitXml, 'xFant'),
            ie: tag(emitXml, 'IE'),
            endereco: `${tag(enderEmitXml, 'xLgr')}, ${tag(enderEmitXml, 'nro')}${tag(enderEmitXml, 'xCpl') ? ' - ' + tag(enderEmitXml, 'xCpl') : ''}`,
            cidade: `${tag(enderEmitXml, 'xMun')}/${tag(enderEmitXml, 'UF')}`,
            uf: tag(enderEmitXml, 'UF'),
            cep: tag(enderEmitXml, 'CEP'),
        },
        destinatario: destXml ? {
            cpf: tag(destXml, 'CPF') || undefined,
            cnpj: tag(destXml, 'CNPJ') || undefined,
            nome: tag(destXml, 'xNome'),
        } : undefined,
        itens,
        totais: {
            vProd: tagNum(totaisXml, 'vProd'),
            vDesc: tagNum(totaisXml, 'vDesc'),
            vFrete: tagNum(totaisXml, 'vFrete'),
            vSeg: tagNum(totaisXml, 'vSeg'),
            vOutro: tagNum(totaisXml, 'vOutro'),
            vNF: tagNum(totaisXml, 'vNF'),
            vBC: tagNum(totaisXml, 'vBC'),
            vICMS: tagNum(totaisXml, 'vICMS'),
            vST: tagNum(totaisXml, 'vST'),
            vIPI: tagNum(totaisXml, 'vIPI'),
            vPIS: tagNum(totaisXml, 'vPIS'),
            vCOFINS: tagNum(totaisXml, 'vCOFINS'),
        },
        pagamentos,
        qrCodeUrl,
        urlChave,
        infAdic: tag(xml, 'infCpl'),
        natOp: tag(xml, 'natOp'),
    };
}

// ============================================================
// DANFE NFC-e (recibo térmico 80mm)
// ============================================================

export async function generateDanfeNFCe(xml: string, status?: string): Promise<Buffer> {
    const data = extractDanfeData(xml);
    const isCancelled = status === 'cancelled';

    // Page width ~80mm = ~227 points (72 pt/inch, 80mm = 3.15 inch)
    const W = 227;
    const MARGIN = 10;
    const CW = W - 2 * MARGIN; // content width

    // Calculate approximate page height
    const itemLines = data.itens.length * 24;
    const baseHeight = 520 + itemLines + (isCancelled ? 30 : 0);
    const pageHeight = Math.max(baseHeight, 400);

    const doc = new PDFDocument({
        size: [W, pageHeight],
        margins: { top: 10, bottom: 10, left: MARGIN, right: MARGIN },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const result = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const FONT_SIZE = 7;
    const FONT_SIZE_SM = 6;
    const FONT_SIZE_LG = 8;
    const LINE = '─'.repeat(35);

    const center = (text: string, size = FONT_SIZE) => {
        doc.fontSize(size).text(text, MARGIN, undefined, { width: CW, align: 'center' });
    };
    const left = (text: string, size = FONT_SIZE) => {
        doc.fontSize(size).text(text, MARGIN, undefined, { width: CW, align: 'left' });
    };

    // Marca de cancelamento no topo
    if (isCancelled) {
        doc.save();
        doc.fontSize(12).fillColor('#DC2626')
            .text('*** CANCELADA ***', MARGIN, undefined, { width: CW, align: 'center' });
        doc.fillColor('#000000');
        doc.restore();
        doc.moveDown(0.3);
    }

    // Header - Emitente
    center(data.emitente.fantasia || data.emitente.nome, FONT_SIZE_LG);
    center(`CNPJ: ${fmtCnpj(data.emitente.cnpj)}`, FONT_SIZE_SM);
    center(data.emitente.endereco, FONT_SIZE_SM);
    center(`${data.emitente.cidade} - CEP: ${data.emitente.cep}`, FONT_SIZE_SM);
    if (data.emitente.ie) center(`IE: ${data.emitente.ie}`, FONT_SIZE_SM);

    doc.moveDown(0.3);
    center(LINE, FONT_SIZE_SM);

    // Title
    center('DANFE NFC-e', FONT_SIZE_LG);
    center('Documento Auxiliar da Nota Fiscal', FONT_SIZE_SM);
    center('de Consumidor Eletrônica', FONT_SIZE_SM);
    if (data.tpAmb === '2') {
        doc.moveDown(0.2);
        center('** AMBIENTE DE HOMOLOGAÇÃO **', FONT_SIZE_LG);
        center('SEM VALOR FISCAL', FONT_SIZE);
    }

    doc.moveDown(0.3);
    center(LINE, FONT_SIZE_SM);

    // Items header
    left('CÓD    DESCRIÇÃO', FONT_SIZE_SM);
    left('QTD   x  VL.UNIT          VL.TOTAL', FONT_SIZE_SM);
    center(LINE, FONT_SIZE_SM);

    // Items
    for (const item of data.itens) {
        left(`${item.codigo}  ${item.descricao}`, FONT_SIZE);
        const qtdStr = `${item.qtd.toFixed(item.qtd % 1 === 0 ? 0 : 4)}`;
        const unitStr = fmtMoney(item.vUnit);
        const totalStr = fmtMoney(item.vTotal);
        doc.fontSize(FONT_SIZE);
        doc.text(`${qtdStr} ${item.un} x ${unitStr}`, MARGIN, undefined, { width: CW * 0.6, continued: false });
        // Total on same line, right-aligned
        const y = doc.y - doc.currentLineHeight();
        doc.text(totalStr, MARGIN, y, { width: CW, align: 'right' });
    }

    center(LINE, FONT_SIZE_SM);

    // Totals
    if (data.totais.vDesc > 0) {
        doc.fontSize(FONT_SIZE);
        doc.text('Desconto', MARGIN, undefined, { width: CW * 0.5, continued: false });
        const yDesc = doc.y - doc.currentLineHeight();
        doc.text(`-${fmtMoney(data.totais.vDesc)}`, MARGIN, yDesc, { width: CW, align: 'right' });
    }

    doc.fontSize(FONT_SIZE_LG);
    doc.text('TOTAL', MARGIN, undefined, { width: CW * 0.5, continued: false });
    const yTotal = doc.y - doc.currentLineHeight();
    doc.text(`R$ ${fmtMoney(data.totais.vNF)}`, MARGIN, yTotal, { width: CW, align: 'right' });

    center(LINE, FONT_SIZE_SM);

    // Payment
    left('FORMA DE PAGAMENTO', FONT_SIZE_SM);
    for (const pag of data.pagamentos) {
        const label = TPAG_MAP[pag.tipo] || `Tipo ${pag.tipo}`;
        doc.fontSize(FONT_SIZE);
        doc.text(label, MARGIN, undefined, { width: CW * 0.6, continued: false });
        const yPag = doc.y - doc.currentLineHeight();
        doc.text(fmtMoney(pag.valor), MARGIN, yPag, { width: CW, align: 'right' });
    }

    // Consumer
    if (data.destinatario?.cpf || data.destinatario?.cnpj) {
        doc.moveDown(0.3);
        const docNum = data.destinatario.cpf
            ? `CPF: ${fmtCpf(data.destinatario.cpf)}`
            : `CNPJ: ${fmtCnpj(data.destinatario.cnpj!)}`;
        center(`Consumidor: ${docNum}`, FONT_SIZE_SM);
    }

    center(LINE, FONT_SIZE_SM);

    // QR Code
    if (data.qrCodeUrl) {
        try {
            const qrPng = await QRCode.toBuffer(data.qrCodeUrl, {
                width: 140,
                margin: 1,
                errorCorrectionLevel: 'M',
            });
            const qrX = (W - 140) / 2;
            doc.image(qrPng, qrX, doc.y, { width: 140 });
            doc.y += 145;
        } catch {
            center('[QR Code indisponível]', FONT_SIZE_SM);
        }
    }

    center(LINE, FONT_SIZE_SM);

    // Access key
    center('Chave de Acesso', FONT_SIZE_SM);
    center(fmtChave(data.chaveAcesso), FONT_SIZE);

    doc.moveDown(0.3);

    // Footer
    center(`NFC-e nº ${data.numero} Série ${data.serie}`, FONT_SIZE);
    center(`Emissão: ${fmtDate(data.dataEmissao)}`, FONT_SIZE_SM);
    if (data.protocolo) {
        center(`Protocolo: ${data.protocolo}`, FONT_SIZE_SM);
    }

    if (data.urlChave) {
        doc.moveDown(0.2);
        center('Consulte pela chave de acesso em:', FONT_SIZE_SM);
        center(data.urlChave, FONT_SIZE_SM);
    }

    doc.end();
    return result;
}

// ============================================================
// DANFE NF-e (A4)
// ============================================================

export async function generateDanfeNFe(xml: string, status?: string): Promise<Buffer> {
    const data = extractDanfeData(xml);
    const isCancelled = status === 'cancelled';

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const result = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const W = 595.28 - 40; // A4 width - margins
    const MARGIN = 20;
    const FONT = 8;
    const FONT_SM = 7;
    const FONT_LG = 10;
    const FONT_TITLE = 12;

    const drawBox = (x: number, y: number, w: number, h: number) => {
        doc.rect(x, y, w, h).stroke();
    };

    const labelValue = (label: string, value: string, x: number, y: number, w: number) => {
        doc.fontSize(5.5).text(label, x + 2, y + 2, { width: w - 4 });
        doc.fontSize(FONT).text(value || '', x + 2, y + 10, { width: w - 4 });
    };

    let Y = 20;

    // ─── HEADER ───
    const headerH = 80;
    drawBox(MARGIN, Y, W, headerH);

    // Company info (left column ~60%)
    const compW = W * 0.55;
    doc.fontSize(FONT_TITLE).text(data.emitente.fantasia || data.emitente.nome, MARGIN + 5, Y + 5, { width: compW - 10 });
    doc.fontSize(FONT_SM).text(data.emitente.nome, MARGIN + 5, Y + 22, { width: compW - 10 });
    doc.fontSize(FONT_SM).text(`${data.emitente.endereco} - ${data.emitente.cidade}`, MARGIN + 5, Y + 32, { width: compW - 10 });
    doc.fontSize(FONT_SM).text(`CEP: ${data.emitente.cep} | CNPJ: ${fmtCnpj(data.emitente.cnpj)} | IE: ${data.emitente.ie}`, MARGIN + 5, Y + 42, { width: compW - 10 });

    // DANFE label (middle)
    const danfeX = MARGIN + compW;
    const danfeW = W * 0.15;
    doc.lineWidth(0.5).moveTo(danfeX, Y).lineTo(danfeX, Y + headerH).stroke();
    doc.fontSize(FONT_TITLE).text('DANFE', danfeX + 2, Y + 5, { width: danfeW - 4, align: 'center' });
    doc.fontSize(FONT_SM).text('Documento Auxiliar da Nota Fiscal Eletrônica', danfeX + 2, Y + 22, { width: danfeW - 4, align: 'center' });
    doc.fontSize(FONT_SM).text(`ENTRADA\nSAÍDA`, danfeX + 2, Y + 50, { width: danfeW - 4, align: 'center' });

    // Number/Series (right)
    const numX = danfeX + danfeW;
    const numW = W - compW - danfeW;
    doc.lineWidth(0.5).moveTo(numX, Y).lineTo(numX, Y + headerH).stroke();
    doc.fontSize(FONT_SM).text('Nº', numX + 2, Y + 5, { width: numW - 4 });
    doc.fontSize(FONT_LG).text(`${data.numero.padStart(9, '0')}`, numX + 2, Y + 15, { width: numW - 4 });
    doc.fontSize(FONT_SM).text(`Série: ${data.serie}`, numX + 2, Y + 30, { width: numW - 4 });
    if (data.tpAmb === '2') {
        doc.fontSize(FONT).text('HOMOLOGAÇÃO', numX + 2, Y + 45, { width: numW - 4, align: 'center' });
        doc.fontSize(FONT_SM).text('SEM VALOR FISCAL', numX + 2, Y + 55, { width: numW - 4, align: 'center' });
    }

    Y += headerH + 2;

    // ─── CHAVE DE ACESSO ───
    const chaveH = 22;
    drawBox(MARGIN, Y, W, chaveH);
    doc.fontSize(5.5).text('CHAVE DE ACESSO', MARGIN + 2, Y + 2);
    doc.fontSize(FONT).text(fmtChave(data.chaveAcesso), MARGIN + 2, Y + 10, { width: W - 4 });
    Y += chaveH + 2;

    // ─── PROTOCOLO ───
    const protoH = 22;
    drawBox(MARGIN, Y, W, protoH);
    doc.fontSize(5.5).text('PROTOCOLO DE AUTORIZAÇÃO', MARGIN + 2, Y + 2);
    const protoText = data.protocolo
        ? `${data.protocolo} - ${fmtDate(data.dataEmissao)}`
        : 'Aguardando autorização';
    doc.fontSize(FONT).text(protoText, MARGIN + 2, Y + 10, { width: W - 4 });
    Y += protoH + 2;

    // ─── NATUREZA DA OPERAÇÃO ───
    const natH = 22;
    drawBox(MARGIN, Y, W, natH);
    labelValue('NATUREZA DA OPERAÇÃO', data.natOp, MARGIN, Y, W);
    Y += natH + 2;

    // ─── DESTINATÁRIO ───
    const destH = 38;
    drawBox(MARGIN, Y, W, destH);
    doc.fontSize(FONT_SM).text('DESTINATÁRIO / REMETENTE', MARGIN + 2, Y + 2, { width: W - 4 });

    const destDoc = data.destinatario?.cnpj
        ? fmtCnpj(data.destinatario.cnpj)
        : data.destinatario?.cpf
        ? fmtCpf(data.destinatario.cpf)
        : '';
    const destNome = data.destinatario?.nome || 'CONSUMIDOR FINAL';

    const col1W = W * 0.6;
    const col2W = W * 0.4;
    labelValue('NOME / RAZÃO SOCIAL', destNome, MARGIN, Y + 10, col1W);
    labelValue('CNPJ/CPF', destDoc, MARGIN + col1W, Y + 10, col2W);

    Y += destH + 2;

    // ─── ITEMS TABLE ───
    const itemHeaderH = 15;
    drawBox(MARGIN, Y, W, itemHeaderH);
    doc.fontSize(FONT_SM);

    const cols = [
        { label: '#', w: 20 },
        { label: 'Código', w: 55 },
        { label: 'Descrição', w: 180 },
        { label: 'NCM', w: 50 },
        { label: 'UN', w: 25 },
        { label: 'Qtd', w: 40 },
        { label: 'Vl.Unit', w: 55 },
        { label: 'Vl.Total', w: W - 425 },
    ];

    let colX = MARGIN + 2;
    for (const col of cols) {
        doc.text(col.label, colX, Y + 4, { width: col.w - 2 });
        colX += col.w;
    }
    Y += itemHeaderH;

    // Items
    for (const item of data.itens) {
        const rowH = 12;
        if (Y + rowH > 800) {
            doc.addPage();
            Y = 20;
        }
        drawBox(MARGIN, Y, W, rowH);
        colX = MARGIN + 2;
        doc.fontSize(FONT_SM);

        const values = [
            String(item.num),
            item.codigo,
            item.descricao,
            item.ncm,
            item.un,
            item.qtd.toFixed(item.qtd % 1 === 0 ? 0 : 4),
            fmtMoney(item.vUnit),
            fmtMoney(item.vTotal),
        ];

        for (let i = 0; i < cols.length; i++) {
            doc.text(values[i], colX, Y + 2, { width: cols[i].w - 2, lineBreak: false });
            colX += cols[i].w;
        }
        Y += rowH;
    }

    Y += 4;

    // ─── TOTALS ───
    const totalH = 38;
    if (Y + totalH > 800) { doc.addPage(); Y = 20; }
    drawBox(MARGIN, Y, W, totalH);
    doc.fontSize(FONT_SM).text('CÁLCULO DO IMPOSTO', MARGIN + 2, Y + 2);

    const tw = W / 4;
    labelValue('BASE CÁLC. ICMS', fmtMoney(data.totais.vBC), MARGIN, Y + 10, tw);
    labelValue('VALOR ICMS', fmtMoney(data.totais.vICMS), MARGIN + tw, Y + 10, tw);
    labelValue('VALOR PRODUTOS', fmtMoney(data.totais.vProd), MARGIN + tw * 2, Y + 10, tw);
    labelValue('VALOR TOTAL NF', fmtMoney(data.totais.vNF), MARGIN + tw * 3, Y + 10, tw);

    Y += totalH + 2;

    // ─── PAYMENT ───
    const pagH = 22;
    if (Y + pagH > 800) { doc.addPage(); Y = 20; }
    drawBox(MARGIN, Y, W, pagH);
    doc.fontSize(FONT_SM).text('FORMAS DE PAGAMENTO', MARGIN + 2, Y + 2);
    const pagText = data.pagamentos
        .map(p => `${TPAG_MAP[p.tipo] || p.tipo}: R$ ${fmtMoney(p.valor)}`)
        .join('  |  ');
    doc.fontSize(FONT).text(pagText, MARGIN + 2, Y + 10, { width: W - 4 });

    Y += pagH + 2;

    // ─── INFO ADICIONAL ───
    if (data.infAdic) {
        const infoH = 30;
        if (Y + infoH > 800) { doc.addPage(); Y = 20; }
        drawBox(MARGIN, Y, W, infoH);
        labelValue('INFORMAÇÕES COMPLEMENTARES', data.infAdic, MARGIN, Y, W);
        Y += infoH + 2;
    }

    // Marca d'água diagonal "CANCELADA" sobre todo o documento
    if (isCancelled) {
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            doc.save();
            doc.translate(297.64, 420.94); // centro A4
            doc.rotate(-45);
            doc.fontSize(60).fillColor('#DC2626').opacity(0.25)
                .text('CANCELADA', -200, -30, { width: 400, align: 'center' });
            doc.opacity(1).fillColor('#000000');
            doc.restore();
        }
    }

    doc.end();
    return result;
}

// ============================================================
// Unified entry point
// ============================================================

export async function generateDanfe(xml: string, status?: string): Promise<Buffer> {
    const modelo = tag(xml, 'mod');
    if (modelo === '65') {
        return generateDanfeNFCe(xml, status);
    }
    return generateDanfeNFe(xml, status);
}
