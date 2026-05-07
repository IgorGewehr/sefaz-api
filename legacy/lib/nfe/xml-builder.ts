// ============================================================
// NFe/NFCe XML Builder - SEFAZ v4.00
// ============================================================

import * as crypto from 'crypto';
import { create } from 'xmlbuilder2';
import { config } from '../../config';
import type {
  NFeRequest,
  NFCeRequest,
  NFeItem,
  NFeItemImposto,
  NFeEmitente,
  NFeDestinatario,
  NFeTransporte,
  NFePagamento,
  NFeCobranca,
  Endereco,
} from '../../types';
import {
  UF_CODES,
  formatarDataSefaz,
  formatarValor,
  apenasNumeros,
} from '../utils';

// ============================================================
// URLs de QR Code por UF
// ============================================================

const NFCE_QRCODE_URL: Record<string, Record<'1' | '2', string>> = {
  AC: { '1': 'http://www.sefaznet.ac.gov.br/nfce/qrcode', '2': 'http://hml.sefaznet.ac.gov.br/nfce/qrcode' },
  AL: { '1': 'https://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp', '2': 'https://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp' },
  AM: { '1': 'https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp', '2': 'https://homnfce.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp' },
  AP: { '1': 'https://www.sefaz.ap.gov.br/nfce/nfcep.php', '2': 'https://www.sefaz.ap.gov.br/nfcehml/nfce.php' },
  BA: { '1': 'https://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx', '2': 'https://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx' },
  CE: { '1': 'https://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html', '2': 'https://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html' },
  DF: { '1': 'https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx', '2': 'https://dec.fazenda.df.gov.br/ConsultarNFCe.aspx' },
  ES: { '1': 'http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx', '2': 'http://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx' },
  GO: { '1': 'https://nfe.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe', '2': 'https://homolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe' },
  MA: { '1': 'https://nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp', '2': 'https://homologacao.sefaz.ma.gov.br/portal/consultarNFCe.jsp' },
  MG: { '1': 'https://nfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', '2': 'https://hnfce.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml' },
  MS: { '1': 'https://www.dfe.ms.gov.br/nfce/qrcode', '2': 'https://www.dfe.ms.gov.br/nfce/qrcode' },
  MT: { '1': 'https://www.sefaz.mt.gov.br/nfce/consultanfce', '2': 'https://homologacao.sefaz.mt.gov.br/nfce/consultanfce' },
  PA: { '1': 'https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/consultanfce.seam', '2': 'https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/consultanfce.seam' },
  PB: { '1': 'https://www.sefaz.pb.gov.br/nfce', '2': 'https://www.sefaz.pb.gov.br/nfcehom' },
  PE: { '1': 'https://nfce.sefaz.pe.gov.br/nfce/consulta', '2': 'https://nfcehomolog.sefaz.pe.gov.br/nfce/consulta' },
  PI: { '1': 'https://www.sefaz.pi.gov.br/nfce/qrcode', '2': 'https://www.sefaz.pi.gov.br/nfce/qrcode' },
  PR: { '1': 'https://www.fazenda.pr.gov.br/nfce/qrcode', '2': 'https://www.fazenda.pr.gov.br/nfce/qrcode' },
  RJ: { '1': 'https://www.nfce.fazenda.rj.gov.br/consulta', '2': 'https://www.nfce.fazenda.rj.gov.br/consulta' },
  RN: { '1': 'https://nfce.set.rn.gov.br/consultarNFCe.aspx', '2': 'https://hom.nfce.set.rn.gov.br/consultarNFCe.aspx' },
  RO: { '1': 'https://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp', '2': 'https://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp' },
  RR: { '1': 'https://www.sefaz.rr.gov.br/nfce/servlet/qrcode', '2': 'https://www.sefaz.rr.gov.br/nfce/servlet/qrcode' },
  RS: { '1': 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', '2': 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx' },
  SC: { '1': 'https://sat.sef.sc.gov.br/nfce/consulta', '2': 'https://hom.sat.sef.sc.gov.br/nfce/consulta' },
  SE: { '1': 'https://nfce.sefaz.se.gov.br/nfce/consultarNFCe.jsp', '2': 'https://nfce.sefaz.se.gov.br/nfce/consultarNFCe.jsp' },
  SP: { '1': 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx', '2': 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx' },
  TO: { '1': 'https://www.sefaz.to.gov.br/nfce/qrcode', '2': 'https://www.sefaz.to.gov.br/nfce/qrcode' },
};

const NFCE_CONSULTA_URL: Record<string, Record<'1' | '2', string>> = {
  AC: { '1': 'http://www.sefaznet.ac.gov.br/nfce/consulta', '2': 'http://hml.sefaznet.ac.gov.br/nfce/consulta' },
  SP: { '1': 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica', '2': 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica' },
  RS: { '1': 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', '2': 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx' },
};

// ============================================================
// Funções auxiliares
// ============================================================

/**
 * Determina o nome do grupo ICMS com base no CST/CSOSN
 */
function getIcmsGroupName(imposto: NFeItemImposto, crt: string): string {
  // Simples Nacional (CRT 1 ou 2)
  if (crt === '1' || crt === '2') {
    const csosn = imposto.icms.csosn || '102';
    switch (csosn) {
      case '101': return 'ICMSSN101';
      case '102':
      case '103':
      case '300':
      case '400': return 'ICMSSN102';
      case '201': return 'ICMSSN201';
      case '202':
      case '203': return 'ICMSSN202';
      case '500': return 'ICMSSN500';
      case '900': return 'ICMSSN900';
      default: return 'ICMSSN102';
    }
  }

  // Regime Normal (CRT 3)
  const cst = imposto.icms.cst || '00';
  switch (cst) {
    case '00': return 'ICMS00';
    case '02': return 'ICMS02';
    case '10': return 'ICMS10';
    case '15': return 'ICMS15';
    case '20': return 'ICMS20';
    case '30': return 'ICMS30';
    case '40':
    case '41':
    case '50': return 'ICMS40';
    case '51': return 'ICMS51';
    case '60': return 'ICMS60';
    case '70': return 'ICMS70';
    case '90': return 'ICMS90';
    default: return 'ICMS00';
  }
}

/**
 * Constroi o grupo ICMS do item
 */
function buildIcmsGroup(imposto: NFeItemImposto, crt: string): Record<string, any> {
  const groupName = getIcmsGroupName(imposto, crt);
  const icms = imposto.icms;
  const group: Record<string, any> = {};

  group['orig'] = icms.orig;

  // Simples Nacional
  if (crt === '1' || crt === '2') {
    if (!icms.csosn) {
      throw new Error('CSOSN obrigatório para Simples Nacional (CRT 1 ou 2)');
    }
    group['CSOSN'] = icms.csosn;

    if (groupName === 'ICMSSN101') {
      if (icms.aliquota !== undefined) group['pCredSN'] = formatarValor(icms.aliquota);
      if (icms.valor !== undefined) group['vCredICMSSN'] = formatarValor(icms.valor);
    } else if (groupName === 'ICMSSN201' || groupName === 'ICMSSN202') {
      if (icms.modBCST) group['modBCST'] = icms.modBCST;
      if (icms.valorBCST !== undefined) group['vBCST'] = formatarValor(icms.valorBCST);
      if (icms.aliquotaST !== undefined) group['pICMSST'] = formatarValor(icms.aliquotaST);
      if (icms.valorST !== undefined) group['vICMSST'] = formatarValor(icms.valorST);
    } else if (groupName === 'ICMSSN500') {
      if (icms.valorBCST !== undefined) group['vBCSTRet'] = formatarValor(icms.valorBCST);
      if (icms.valorST !== undefined) group['vICMSSTRet'] = formatarValor(icms.valorST);
    } else if (groupName === 'ICMSSN900') {
      if (icms.modBC) group['modBC'] = icms.modBC;
      if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
      if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
      if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
      if (icms.modBCST) group['modBCST'] = icms.modBCST;
      if (icms.valorBCST !== undefined) group['vBCST'] = formatarValor(icms.valorBCST);
      if (icms.aliquotaST !== undefined) group['pICMSST'] = formatarValor(icms.aliquotaST);
      if (icms.valorST !== undefined) group['vICMSST'] = formatarValor(icms.valorST);
    }
    // ICMSSN102 (102, 103, 300, 400) - só orig e CSOSN
  } else {
    // Regime Normal
    if (!icms.cst) {
      throw new Error('CST ICMS obrigatório para Regime Normal (CRT 3)');
    }
    group['CST'] = icms.cst;

    switch (groupName) {
      case 'ICMS00':
        if (!icms.modBC) {
          throw new Error('Modalidade BC (modBC) obrigatória para CST 00');
        }
        group['modBC'] = icms.modBC;
        if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
        if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
        if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
        break;
      case 'ICMS02':
        // CST 02 - Tributação monofásica própria sobre combustíveis
        if (icms.valorBC !== undefined) group['qBCMono'] = formatarValor(icms.valorBC, 4);
        if (icms.aliquota !== undefined) group['adRemICMS'] = formatarValor(icms.aliquota, 4);
        if (icms.valor !== undefined) group['vICMSMono'] = formatarValor(icms.valor);
        break;
      case 'ICMS10':
        if (!icms.modBC) {
          throw new Error('Modalidade BC (modBC) obrigatória para CST 10');
        }
        group['modBC'] = icms.modBC;
        if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
        if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
        if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
        if (icms.modBCST) group['modBCST'] = icms.modBCST;
        if (icms.valorBCST !== undefined) group['vBCST'] = formatarValor(icms.valorBCST);
        if (icms.aliquotaST !== undefined) group['pICMSST'] = formatarValor(icms.aliquotaST);
        if (icms.valorST !== undefined) group['vICMSST'] = formatarValor(icms.valorST);
        break;
      case 'ICMS15':
        // CST 15 - Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis
        if (icms.valorBC !== undefined) group['qBCMono'] = formatarValor(icms.valorBC, 4);
        if (icms.aliquota !== undefined) group['adRemICMS'] = formatarValor(icms.aliquota, 4);
        if (icms.valor !== undefined) group['vICMSMono'] = formatarValor(icms.valor);
        if (icms.valorBCST !== undefined) group['qBCMonoReten'] = formatarValor(icms.valorBCST, 4);
        if (icms.aliquotaST !== undefined) group['adRemICMSReten'] = formatarValor(icms.aliquotaST, 4);
        if (icms.valorST !== undefined) group['vICMSMonoReten'] = formatarValor(icms.valorST);
        break;
      case 'ICMS20':
        if (!icms.modBC) {
          throw new Error('Modalidade BC (modBC) obrigatória para CST 20');
        }
        group['modBC'] = icms.modBC;
        if (icms.pRedBC !== undefined) group['pRedBC'] = formatarValor(icms.pRedBC);
        if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
        if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
        if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
        break;
      case 'ICMS30':
        if (icms.modBCST) group['modBCST'] = icms.modBCST;
        if (icms.valorBCST !== undefined) group['vBCST'] = formatarValor(icms.valorBCST);
        if (icms.aliquotaST !== undefined) group['pICMSST'] = formatarValor(icms.aliquotaST);
        if (icms.valorST !== undefined) group['vICMSST'] = formatarValor(icms.valorST);
        break;
      case 'ICMS40':
        // CST 40, 41, 50 - Isento, não tributado, suspensão - apenas orig e CST
        break;
      case 'ICMS51':
        if (!icms.modBC) {
          throw new Error('Modalidade BC (modBC) obrigatória para CST 51');
        }
        group['modBC'] = icms.modBC;
        if (icms.pRedBC !== undefined) group['pRedBC'] = formatarValor(icms.pRedBC);
        if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
        if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
        if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
        break;
      case 'ICMS60':
        if (icms.valorBCST !== undefined) group['vBCSTRet'] = formatarValor(icms.valorBCST);
        if (icms.valorST !== undefined) group['vICMSSTRet'] = formatarValor(icms.valorST);
        break;
      case 'ICMS70':
        if (!icms.modBC) {
          throw new Error('Modalidade BC (modBC) obrigatória para CST 70');
        }
        group['modBC'] = icms.modBC;
        if (icms.pRedBC !== undefined) group['pRedBC'] = formatarValor(icms.pRedBC);
        if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
        if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
        if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
        if (icms.modBCST) group['modBCST'] = icms.modBCST;
        if (icms.valorBCST !== undefined) group['vBCST'] = formatarValor(icms.valorBCST);
        if (icms.aliquotaST !== undefined) group['pICMSST'] = formatarValor(icms.aliquotaST);
        if (icms.valorST !== undefined) group['vICMSST'] = formatarValor(icms.valorST);
        break;
      case 'ICMS90':
        if (!icms.modBC) {
          throw new Error('Modalidade BC (modBC) obrigatória para CST 90');
        }
        group['modBC'] = icms.modBC;
        if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
        if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
        if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
        if (icms.modBCST) group['modBCST'] = icms.modBCST;
        if (icms.valorBCST !== undefined) group['vBCST'] = formatarValor(icms.valorBCST);
        if (icms.aliquotaST !== undefined) group['pICMSST'] = formatarValor(icms.aliquotaST);
        if (icms.valorST !== undefined) group['vICMSST'] = formatarValor(icms.valorST);
        break;
    }
  }

  return { [groupName]: group };
}

/**
 * Constroi o grupo PIS do item
 */
function buildPisGroup(pis: NFeItemImposto['pis']): Record<string, any> {
  const cst = pis.cst;

  // PIS tributado pela aliquota
  if (['01', '02'].includes(cst)) {
    return {
      PISAliq: {
        CST: cst,
        vBC: formatarValor(pis.valorBC || 0),
        pPIS: formatarValor(pis.aliquota || 0, 4),
        vPIS: formatarValor(pis.valor || 0),
      },
    };
  }

  // PIS tributado por quantidade
  if (cst === '03') {
    return {
      PISQtde: {
        CST: cst,
        qBCProd: formatarValor(pis.valorBC || 0, 4),
        vAliqProd: formatarValor(pis.aliquota || 0, 4),
        vPIS: formatarValor(pis.valor || 0),
      },
    };
  }

  // PIS não tributado
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) {
    return {
      PISNT: {
        CST: cst,
      },
    };
  }

  // PIS outras operações
  if (cst === '49' || cst === '50' || cst === '51' || cst === '52' ||
      cst === '53' || cst === '54' || cst === '55' || cst === '56' ||
      cst === '60' || cst === '61' || cst === '62' || cst === '63' ||
      cst === '64' || cst === '65' || cst === '66' || cst === '67' ||
      cst === '70' || cst === '71' || cst === '72' || cst === '73' ||
      cst === '74' || cst === '75' || cst === '98' || cst === '99') {
    const pisOutr: Record<string, any> = { CST: cst };
    if (pis.valorBC !== undefined) pisOutr['vBC'] = formatarValor(pis.valorBC);
    if (pis.aliquota !== undefined) pisOutr['pPIS'] = formatarValor(pis.aliquota, 4);
    if (pis.valor !== undefined) pisOutr['vPIS'] = formatarValor(pis.valor);
    return { PISOutr: pisOutr };
  }

  // Fallback: PIS não tributado
  return {
    PISNT: {
      CST: cst,
    },
  };
}

/**
 * Constroi o grupo COFINS do item
 */
function buildCofinsGroup(cofins: NFeItemImposto['cofins']): Record<string, any> {
  const cst = cofins.cst;

  // COFINS tributado pela aliquota
  if (['01', '02'].includes(cst)) {
    return {
      COFINSAliq: {
        CST: cst,
        vBC: formatarValor(cofins.valorBC || 0),
        pCOFINS: formatarValor(cofins.aliquota || 0, 4),
        vCOFINS: formatarValor(cofins.valor || 0),
      },
    };
  }

  // COFINS tributado por quantidade
  if (cst === '03') {
    return {
      COFINSQtde: {
        CST: cst,
        qBCProd: formatarValor(cofins.valorBC || 0, 4),
        vAliqProd: formatarValor(cofins.aliquota || 0, 4),
        vCOFINS: formatarValor(cofins.valor || 0),
      },
    };
  }

  // COFINS não tributado
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) {
    return {
      COFINSNT: {
        CST: cst,
      },
    };
  }

  // COFINS outras operações
  if (cst === '49' || cst === '50' || cst === '51' || cst === '52' ||
      cst === '53' || cst === '54' || cst === '55' || cst === '56' ||
      cst === '60' || cst === '61' || cst === '62' || cst === '63' ||
      cst === '64' || cst === '65' || cst === '66' || cst === '67' ||
      cst === '70' || cst === '71' || cst === '72' || cst === '73' ||
      cst === '74' || cst === '75' || cst === '98' || cst === '99') {
    const cofOutr: Record<string, any> = { CST: cst };
    if (cofins.valorBC !== undefined) cofOutr['vBC'] = formatarValor(cofins.valorBC);
    if (cofins.aliquota !== undefined) cofOutr['pCOFINS'] = formatarValor(cofins.aliquota, 4);
    if (cofins.valor !== undefined) cofOutr['vCOFINS'] = formatarValor(cofins.valor);
    return { COFINSOutr: cofOutr };
  }

  // Fallback
  return {
    COFINSNT: {
      CST: cst,
    },
  };
}

/**
 * Constroi o grupo IPI do item (quando existir)
 */
function buildIpiGroup(ipi: NonNullable<NFeItemImposto['ipi']>): Record<string, any> {
  const result: Record<string, any> = {
    cEnq: ipi.cEnq,
  };

  // IPI tributado
  if (['00', '49', '50', '99'].includes(ipi.cst)) {
    result['IPITrib'] = {
      CST: ipi.cst,
      vBC: formatarValor(ipi.valorBC || 0),
      pIPI: formatarValor(ipi.aliquota || 0),
      vIPI: formatarValor(ipi.valor || 0),
    };
  } else {
    // IPI não tributado
    result['IPINT'] = {
      CST: ipi.cst,
    };
  }

  return result;
}

/**
 * Calcula os totais da nota a partir dos itens
 */
function calcularTotais(itens: NFeItem[]): Record<string, string> {
  let vBC = 0, vICMS = 0, vICMSDeson = 0, vFCP = 0;
  let vBCST = 0, vST = 0, vFCPST = 0, vFCPSTRet = 0;
  let vProd = 0, vFrete = 0, vSeg = 0, vDesc = 0;
  let vII = 0, vIPI = 0, vIPIDevol = 0;
  let vPIS = 0, vCOFINS = 0, vOutro = 0;

  for (const item of itens) {
    const prod = item.produto;
    const imp = item.imposto;

    if (prod.indTot === '1') {
      vProd += prod.valorTotal;
    }

    vFrete += prod.valorFrete || 0;
    vSeg += prod.valorSeguro || 0;
    vDesc += prod.valorDesconto || 0;
    vOutro += prod.valorOutro || 0;

    // ICMS
    vBC += imp.icms.valorBC || 0;
    vICMS += imp.icms.valor || 0;
    vBCST += imp.icms.valorBCST || 0;
    vST += imp.icms.valorST || 0;

    // PIS/COFINS
    vPIS += imp.pis.valor || 0;
    vCOFINS += imp.cofins.valor || 0;

    // IPI
    if (imp.ipi) {
      vIPI += imp.ipi.valor || 0;
    }
  }

  const vNF = vProd + vST + vFrete + vSeg + vOutro + vII + vIPI - vDesc;

  return {
    vBC: formatarValor(vBC),
    vICMS: formatarValor(vICMS),
    vICMSDeson: formatarValor(vICMSDeson),
    vFCPUFDest: formatarValor(0),
    vICMSUFDest: formatarValor(0),
    vICMSUFRemet: formatarValor(0),
    vFCP: formatarValor(vFCP),
    vBCST: formatarValor(vBCST),
    vST: formatarValor(vST),
    vFCPST: formatarValor(vFCPST),
    vFCPSTRet: formatarValor(vFCPSTRet),
    vProd: formatarValor(vProd),
    vFrete: formatarValor(vFrete),
    vSeg: formatarValor(vSeg),
    vDesc: formatarValor(vDesc),
    vII: formatarValor(vII),
    vIPI: formatarValor(vIPI),
    vIPIDevol: formatarValor(vIPIDevol),
    vPIS: formatarValor(vPIS),
    vCOFINS: formatarValor(vCOFINS),
    vOutro: formatarValor(vOutro),
    vNF: formatarValor(vNF),
  };
}

/**
 * Constroi o grupo de endereço
 */
function buildEnderecoGroup(endereco: Endereco, tag: string): Record<string, any> {
  const end: Record<string, any> = {
    xLgr: endereco.logradouro,
    nro: endereco.numero,
  };
  if (endereco.complemento) end['xCpl'] = endereco.complemento;
  end['xBairro'] = endereco.bairro;
  end['cMun'] = endereco.codigoMunicipio;
  end['xMun'] = endereco.municipio;
  end['UF'] = endereco.uf;
  end['CEP'] = apenasNumeros(endereco.cep);
  end['cPais'] = endereco.codigoPais || '1058';
  end['xPais'] = endereco.pais || 'Brasil';
  if (endereco.telefone) end['fone'] = apenasNumeros(endereco.telefone);

  return { [tag]: end };
}

/**
 * Constroi o grupo <ide> (identificação do documento fiscal)
 */
function buildIdeGroup(params: {
  cUF: string;
  cNF: string;
  natOp: string;
  mod: '55' | '65';
  serie: string;
  nNF: number;
  dhEmi: string;
  tpNF: string;
  idDest: string;
  cMunFG: string;
  tpImp: string;
  tpEmis: string;
  cDV: string;
  tpAmb: '1' | '2';
  finNFe: string;
  indFinal: string;
  indPres: string;
  indIntermed?: string;
  procEmi: string;
  verProc: string;
  dhSaiEnt?: string;
}): Record<string, any> {
  const ide: Record<string, any> = {
    cUF: params.cUF,
    cNF: params.cNF,
    natOp: params.natOp,
    mod: params.mod,
    serie: params.serie,
    nNF: String(params.nNF),
    dhEmi: params.dhEmi,
  };

  if (params.dhSaiEnt) {
    ide['dhSaiEnt'] = params.dhSaiEnt;
  }

  ide['tpNF'] = params.tpNF;
  ide['idDest'] = params.idDest;
  ide['cMunFG'] = params.cMunFG;
  ide['tpImp'] = params.tpImp;
  ide['tpEmis'] = params.tpEmis;
  ide['cDV'] = params.cDV;
  ide['tpAmb'] = params.tpAmb;
  ide['finNFe'] = params.finNFe;
  ide['indFinal'] = params.indFinal;
  ide['indPres'] = params.indPres;

  if (params.indIntermed !== undefined) {
    ide['indIntermed'] = params.indIntermed;
  }

  ide['procEmi'] = params.procEmi;
  ide['verProc'] = params.verProc;

  return ide;
}

/**
 * Constroi o grupo <emit> (emitente)
 */
function buildEmitenteGroup(emitente: NFeEmitente): Record<string, any> {
  const emit: Record<string, any> = {
    CNPJ: apenasNumeros(emitente.cnpj),
    xNome: emitente.nome,
  };

  if (emitente.nomeFantasia) {
    emit['xFant'] = emitente.nomeFantasia;
  }

  Object.assign(emit, buildEnderecoGroup(emitente.endereco, 'enderEmit'));

  // IE: aceita "ISENTO" (literal) ou apenas dígitos (TIeEmi: ISENTO|[0-9]{2,14})
  emit['IE'] = String(emitente.inscricaoEstadual).trim().toUpperCase() === 'ISENTO'
    ? 'ISENTO'
    : apenasNumeros(emitente.inscricaoEstadual);

  if (emitente.inscricaoMunicipal) {
    emit['IM'] = emitente.inscricaoMunicipal;
  }

  emit['CRT'] = emitente.crt;

  return emit;
}

/**
 * Constroi o grupo <dest> (destinatário) para NFe
 */
function buildDestinatarioGroup(dest: NFeDestinatario, tpAmb: '1' | '2'): Record<string, any> {
  const destGroup: Record<string, any> = {};

  if (dest.cnpj) {
    destGroup['CNPJ'] = apenasNumeros(dest.cnpj);
  } else if (dest.cpf) {
    destGroup['CPF'] = apenasNumeros(dest.cpf);
  } else if (dest.idEstrangeiro) {
    destGroup['idEstrangeiro'] = dest.idEstrangeiro;
  }

  // Em homologacao SEFAZ exige nome fixo
  destGroup['xNome'] = tpAmb === '2' ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : dest.nome;

  if (dest.endereco) {
    Object.assign(destGroup, buildEnderecoGroup(dest.endereco, 'enderDest'));
  }

  destGroup['indIEDest'] = dest.indicadorIE;

  if (dest.inscricaoEstadual && dest.indicadorIE === '1') {
    destGroup['IE'] = apenasNumeros(dest.inscricaoEstadual);
  }

  if (dest.email) {
    destGroup['email'] = dest.email;
  }

  return destGroup;
}

/**
 * Constroi o grupo <det> (itens)
 */
function buildDetGroups(itens: NFeItem[], crt: string): Array<Record<string, any>> {
  return itens.map((item) => {
    const prod: Record<string, any> = {
      cProd: item.produto.codigo,
      cEAN: item.produto.cEAN,
      xProd: item.produto.descricao,
      NCM: item.produto.ncm,
    };

    if (item.produto.cest) {
      prod['CEST'] = item.produto.cest;
    }

    prod['CFOP'] = item.produto.cfop;
    prod['uCom'] = item.produto.unidade;
    prod['qCom'] = formatarValor(item.produto.quantidade, 4);
    prod['vUnCom'] = formatarValor(item.produto.valorUnitario, 10);
    prod['vProd'] = formatarValor(item.produto.valorTotal);
    prod['cEANTrib'] = item.produto.cEANTrib;
    prod['uTrib'] = item.produto.unidadeTrib;
    prod['qTrib'] = formatarValor(item.produto.quantidadeTrib, 4);
    prod['vUnTrib'] = formatarValor(item.produto.valorUnitarioTrib, 10);

    if (item.produto.valorFrete) {
      prod['vFrete'] = formatarValor(item.produto.valorFrete);
    }
    if (item.produto.valorSeguro) {
      prod['vSeg'] = formatarValor(item.produto.valorSeguro);
    }
    if (item.produto.valorDesconto) {
      prod['vDesc'] = formatarValor(item.produto.valorDesconto);
    }
    if (item.produto.valorOutro) {
      prod['vOutro'] = formatarValor(item.produto.valorOutro);
    }

    prod['indTot'] = item.produto.indTot;

    // Impostos
    const impostoGroup: Record<string, any> = {};

    // ICMS
    impostoGroup['ICMS'] = buildIcmsGroup(item.imposto, crt);

    // IPI (antes do PIS para NFe modelo 55)
    if (item.imposto.ipi) {
      impostoGroup['IPI'] = buildIpiGroup(item.imposto.ipi);
    }

    // PIS
    impostoGroup['PIS'] = buildPisGroup(item.imposto.pis);

    // COFINS
    impostoGroup['COFINS'] = buildCofinsGroup(item.imposto.cofins);

    return {
      '@nItem': String(item.numero),
      prod,
      imposto: impostoGroup,
    };
  });
}

/**
 * Constroi o grupo <transp> (transporte)
 */
function buildTransporteGroup(transp: NFeTransporte): Record<string, any> {
  const transpGroup: Record<string, any> = {
    modFrete: transp.modFrete,
  };

  if (transp.transportadora) {
    const t = transp.transportadora;
    const transporta: Record<string, any> = {};
    if (t.cnpj) transporta['CNPJ'] = apenasNumeros(t.cnpj);
    else if (t.cpf) transporta['CPF'] = apenasNumeros(t.cpf);
    if (t.nome) transporta['xNome'] = t.nome;
    if (t.inscricaoEstadual) transporta['IE'] = apenasNumeros(t.inscricaoEstadual);
    if (t.endereco) transporta['xEnder'] = t.endereco;
    if (t.municipio) transporta['xMun'] = t.municipio;
    if (t.uf) transporta['UF'] = t.uf;
    transpGroup['transporta'] = transporta;
  }

  if (transp.volumes && transp.volumes.length > 0) {
    transpGroup['vol'] = transp.volumes.map((v) => {
      const vol: Record<string, any> = {};
      if (v.quantidade !== undefined) vol['qVol'] = String(v.quantidade);
      if (v.especie) vol['esp'] = v.especie;
      if (v.marca) vol['marca'] = v.marca;
      if (v.numeracao) vol['nVol'] = v.numeracao;
      if (v.pesoLiquido !== undefined) vol['pesoL'] = formatarValor(v.pesoLiquido, 3);
      if (v.pesoBruto !== undefined) vol['pesoB'] = formatarValor(v.pesoBruto, 3);
      return vol;
    });
  }

  return transpGroup;
}

/**
 * Constroi o grupo <pag> (pagamento)
 */
function buildPagamentoGroup(pag: NFePagamento): Record<string, any> {
  const pagGroup: Record<string, any> = {};

  pagGroup['detPag'] = pag.formas.map((forma) => {
    const detPag: Record<string, any> = {
      tPag: forma.tipo,
      vPag: formatarValor(forma.valor),
    };

    if (forma.cartao) {
      detPag['card'] = {
        tpIntegra: forma.cartao.tipoIntegracao,
      };
      if (forma.cartao.cnpj) detPag['card']['CNPJ'] = apenasNumeros(forma.cartao.cnpj);
      if (forma.cartao.bandeira) detPag['card']['tBand'] = forma.cartao.bandeira;
      if (forma.cartao.autorizacao) detPag['card']['cAut'] = forma.cartao.autorizacao;
    }

    return detPag;
  });

  if (pag.troco && pag.troco > 0) {
    pagGroup['vTroco'] = formatarValor(pag.troco);
  }

  return pagGroup;
}

/**
 * Constroi o grupo <cobr> (cobranca) para NFe
 */
function buildCobrancaGroup(cobr: NFeCobranca): Record<string, any> {
  const cobrGroup: Record<string, any> = {};

  if (cobr.fatura) {
    const fat: Record<string, any> = {};
    if (cobr.fatura.numero) fat['nFat'] = cobr.fatura.numero;
    if (cobr.fatura.valorOriginal !== undefined) fat['vOrig'] = formatarValor(cobr.fatura.valorOriginal);
    if (cobr.fatura.valorDesconto !== undefined) fat['vDesc'] = formatarValor(cobr.fatura.valorDesconto);
    if (cobr.fatura.valorLiquido !== undefined) fat['vLiq'] = formatarValor(cobr.fatura.valorLiquido);
    cobrGroup['fat'] = fat;
  }

  if (cobr.duplicatas && cobr.duplicatas.length > 0) {
    cobrGroup['dup'] = cobr.duplicatas.map((d) => ({
      nDup: d.numero,
      dVenc: d.vencimento,
      vDup: formatarValor(d.valor),
    }));
  }

  return cobrGroup;
}

/**
 * Gera o QR Code para NFCe
 */
function gerarQRCodeNFCe(params: {
  chNFe: string;
  versaoQRCode: string;
  tpAmb: '1' | '2';
  csc: { id: string; token: string };
  uf: string;
}): { qrCodeUrl: string; urlChave: string } {
  const { chNFe, versaoQRCode, tpAmb, csc, uf } = params;

  const urlQRCode = NFCE_QRCODE_URL[uf.toUpperCase()]?.[tpAmb];
  if (!urlQRCode) {
    throw new Error(`URL de QR Code não encontrada para UF: ${uf}, ambiente: ${tpAmb}`);
  }

  let qrCodeUrl: string;

  if (versaoQRCode === '3') {
    // QR Code v3 (NT 2025.001) - emissão online: sem CSC, sem hash
    qrCodeUrl = `${urlQRCode}?p=${chNFe}|${versaoQRCode}|${tpAmb}`;
  } else {
    // QR Code v2 - formato legado
    const cIdToken = csc.id.padStart(6, '0');
    const concat = `${chNFe}|${versaoQRCode}|${tpAmb}|${cIdToken}${csc.token}`;
    const hashQRCode = crypto.createHash('sha256').update(concat).digest('hex').toUpperCase();
    qrCodeUrl = `${urlQRCode}?p=${chNFe}|${versaoQRCode}|${tpAmb}|${cIdToken}|${hashQRCode}`;
  }

  // URL de consulta por chave
  const consultaUrl = NFCE_CONSULTA_URL[uf.toUpperCase()]?.[tpAmb] || urlQRCode;

  return { qrCodeUrl, urlChave: consultaUrl };
}

// ============================================================
// Funções públicas
// ============================================================

/**
 * Constroi o XML completo da NFe (modelo 55) segundo o layout SEFAZ v4.00
 */
export function buildNFeXml(
  request: NFeRequest,
  chaveAcesso: string,
  numero: number,
  tpAmb: '1' | '2',
): string {
  // Validação rápida de campos críticos
  if (!request.itens || request.itens.length === 0) {
    throw new Error('NF-e deve ter ao menos 1 item');
  }

  request.itens.forEach((item, i) => {
    if (!item.produto.ncm || item.produto.ncm.length !== 8) {
      throw new Error(`Item ${i+1}: NCM inválido`);
    }
    if (!item.produto.cfop || item.produto.cfop.length !== 4) {
      throw new Error(`Item ${i+1}: CFOP inválido`);
    }
    if (!item.imposto.icms.orig) {
      throw new Error(`Item ${i+1}: origem ICMS obrigatória`);
    }
  });

  const cUF = UF_CODES[request.ufEmitente.toUpperCase()];
  if (!cUF) {
    throw new Error(`UF inválida: ${request.ufEmitente}`);
  }

  const cNF = chaveAcesso.substring(35, 43);
  const cDV = chaveAcesso.substring(43, 44);
  const dhEmi = formatarDataSefaz(undefined, request.ufEmitente);
  const serie = request.serie || '1';

  // Identificação do destino da operação
  // 1=Interna, 2=Interestadual, 3=Exterior
  const ufEmitente = request.emitente.endereco.uf;
  const ufDest = request.destinatario.endereco?.uf;
  let idDest = '1'; // Interna
  if (ufDest && ufDest !== ufEmitente) {
    idDest = ufDest === 'EX' ? '3' : '2';
  }

  const ide = buildIdeGroup({
    cUF,
    cNF,
    natOp: request.naturezaOperacao,
    mod: '55',
    serie,
    nNF: numero,
    dhEmi,
    tpNF: request.tipoOperacao,
    idDest,
    cMunFG: request.emitente.endereco.codigoMunicipio,
    tpImp: '1', // 1=DANFE retrato
    tpEmis: '1', // 1=Emissão normal
    cDV,
    tpAmb,
    finNFe: request.finalidade,
    indFinal: request.consumidorFinal,
    indPres: request.presencaComprador,
    indIntermed: (request.presencaComprador === '2' || request.presencaComprador === '9') ? '0' : undefined,
    procEmi: '0', // 0=Emissão com aplicação do contribuinte
    verProc: 'SefazAPI-1.0',
  });

  const emit = buildEmitenteGroup(request.emitente);
  const dest = buildDestinatarioGroup(request.destinatario, tpAmb);
  const det = buildDetGroups(request.itens, request.emitente.crt);
  const totais = calcularTotais(request.itens);
  const transp = buildTransporteGroup(request.transporte);
  const pag = buildPagamentoGroup(request.pagamento);

  // Montar estrutura da NFe
  const nfeObj: Record<string, any> = {
    NFe: {
      '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
      infNFe: {
        '@versao': '4.00',
        '@Id': `NFe${chaveAcesso}`,
        ide,
        emit,
        dest,
        det,
        total: {
          ICMSTot: totais,
        },
        transp,
      },
    },
  };

  // Cobrança (opcional, para NFe com duplicatas)
  if (request.cobranca) {
    nfeObj.NFe.infNFe['cobr'] = buildCobrancaGroup(request.cobranca);
  }

  // Pagamento
  nfeObj.NFe.infNFe['pag'] = pag;

  // Informações adicionais
  if (request.informacoesAdicionais) {
    const infAdic: Record<string, any> = {};
    if (request.informacoesAdicionais.fisco) {
      infAdic['infAdFisco'] = request.informacoesAdicionais.fisco;
    }
    if (request.informacoesAdicionais.contribuinte) {
      infAdic['infCpl'] = request.informacoesAdicionais.contribuinte;
    }
    if (Object.keys(infAdic).length > 0) {
      nfeObj.NFe.infNFe['infAdic'] = infAdic;
    }
  }

  // Responsável técnico (NT 2025.001 - obrigatório)
  nfeObj.NFe.infNFe['infRespTec'] = {
    CNPJ: config.respTec.cnpj,
    xContato: config.respTec.contato,
    email: config.respTec.email,
    fone: config.respTec.fone,
  };

  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(nfeObj);
  return doc.end({ prettyPrint: false });
}

/**
 * Constroi o XML completo da NFCe (modelo 65) segundo o layout SEFAZ v4.00
 */
export function buildNFCeXml(
  request: NFCeRequest,
  chaveAcesso: string,
  numero: number,
  tpAmb: '1' | '2',
): string {
  // Validação rápida de campos críticos
  if (!request.itens || request.itens.length === 0) {
    throw new Error('NFC-e deve ter ao menos 1 item');
  }

  request.itens.forEach((item, i) => {
    if (!item.produto.ncm || item.produto.ncm.length !== 8) {
      throw new Error(`Item ${i+1}: NCM inválido`);
    }
    if (!item.produto.cfop || item.produto.cfop.length !== 4) {
      throw new Error(`Item ${i+1}: CFOP inválido`);
    }
    if (!item.imposto.icms.orig) {
      throw new Error(`Item ${i+1}: origem ICMS obrigatória`);
    }
  });

  const cUF = UF_CODES[request.ufEmitente.toUpperCase()];
  if (!cUF) {
    throw new Error(`UF inválida: ${request.ufEmitente}`);
  }

  const cNF = chaveAcesso.substring(35, 43);
  const cDV = chaveAcesso.substring(43, 44);
  const dhEmi = formatarDataSefaz(undefined, request.ufEmitente);
  const serie = request.serie || '1';

  const ide = buildIdeGroup({
    cUF,
    cNF,
    natOp: 'VENDA AO CONSUMIDOR',
    mod: '65',
    serie,
    nNF: numero,
    dhEmi,
    tpNF: '1', // 1=Saída (NFCe é sempre venda)
    idDest: '1', // 1=Operação interna (NFCe é sempre interna)
    cMunFG: request.emitente.endereco.codigoMunicipio,
    tpImp: '4', // 4=DANFE NFCe
    tpEmis: '1', // 1=Emissão normal
    cDV,
    tpAmb,
    finNFe: '1', // 1=Normal
    indFinal: '1', // 1=Consumidor final (NFCe sempre)
    indPres: '1', // 1=Presencial
    procEmi: '0',
    verProc: 'SefazAPI-1.0',
  });

  const emit = buildEmitenteGroup(request.emitente);
  const det = buildDetGroups(request.itens, request.emitente.crt);
  const totais = calcularTotais(request.itens);
  const transp = buildTransporteGroup(request.transporte);
  const pag = buildPagamentoGroup(request.pagamento);

  // Montar estrutura da NFCe
  const nfceObj: Record<string, any> = {
    NFe: {
      '@xmlns': 'http://www.portalfiscal.inf.br/nfe',
      infNFe: {
        '@versao': '4.00',
        '@Id': `NFe${chaveAcesso}`,
        ide,
        emit,
      },
    },
  };

  // Destinatário (consumidor) - opcional para NFCe
  if (request.consumidor && (request.consumidor.cpf || request.consumidor.cnpj)) {
    const dest: Record<string, any> = {};
    if (request.consumidor.cnpj) {
      dest['CNPJ'] = apenasNumeros(request.consumidor.cnpj);
    } else if (request.consumidor.cpf) {
      dest['CPF'] = apenasNumeros(request.consumidor.cpf);
    }
    if (request.consumidor.nome) {
      dest['xNome'] = tpAmb === '2'
        ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
        : request.consumidor.nome;
    }
    dest['indIEDest'] = '9'; // Não contribuinte (NFCe)
    nfceObj.NFe.infNFe['dest'] = dest;
  }

  nfceObj.NFe.infNFe['det'] = det;
  nfceObj.NFe.infNFe['total'] = { ICMSTot: totais };
  nfceObj.NFe.infNFe['transp'] = transp;
  nfceObj.NFe.infNFe['pag'] = pag;

  // Informações adicionais
  if (request.informacoesAdicionais?.contribuinte) {
    nfceObj.NFe.infNFe['infAdic'] = {
      infCpl: request.informacoesAdicionais.contribuinte,
    };
  }

  // Responsável técnico (NT 2025.001 - obrigatório)
  nfceObj.NFe.infNFe['infRespTec'] = {
    CNPJ: config.respTec.cnpj,
    xContato: config.respTec.contato,
    email: config.respTec.email,
    fone: config.respTec.fone,
  };

  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(nfceObj);
  return doc.end({ prettyPrint: false });
}

/**
 * Gera o fragmento XML infNFeSupl para NFCe (deve ser inserido após assinatura)
 */
export function buildNFCeSupl(
  chaveAcesso: string,
  tpAmb: '1' | '2',
  csc: { id: string; token: string },
  uf: string,
): string {
  const qrCode = gerarQRCodeNFCe({
    chNFe: chaveAcesso,
    versaoQRCode: '3',
    tpAmb,
    csc,
    uf,
  });

  return `<infNFeSupl><qrCode>${qrCode.qrCodeUrl}</qrCode><urlChave>${qrCode.urlChave}</urlChave></infNFeSupl>`;
}
