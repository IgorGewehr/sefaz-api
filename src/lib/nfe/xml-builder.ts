// ============================================================
// NFe/NFCe XML Builder - SEFAZ v4.00
// ============================================================

import * as crypto from 'crypto';
import { create } from 'xmlbuilder2';
import { config } from '../../config';
import type {
  CertificateData,
  NFeRequest,
  NFCeRequest,
  NFeItem,
  NFeItemImposto,
  NFeEmitente,
  NFeDestinatario,
  NFeTransporte,
  NFePagamento,
  NFeCobranca,
  NFeReference,
  Endereco,
} from '../../types';
import {
  UF_CODES,
  formatarDataSefaz,
  formatarValor,
  apenasNumeros,
  parsePfx,
  truncar,
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

// urlChave (consulta por chave de acesso, impresso no DANFCE) por UF.
// Fonte: nfephp-org/sped-nfe (master) storage/uri_consulta_nfce.json —
// valores verbatim ('1'=produção, '2'=homologação), conferido em 2026-06.
// As 27 UFs têm entrada na fonte; o fallback `|| urlQRCode` (em
// gerarQRCodeNFCe e buildNFCeSuplContingencia) fica só como rede de
// segurança para UF fora da tabela.
const NFCE_CONSULTA_URL: Record<string, Record<'1' | '2', string>> = {
  AC: { '1': 'www.sefaznet.ac.gov.br/nfce/consulta', '2': 'www.sefaznet.ac.gov.br/nfce/consulta' },
  AL: { '1': 'www.sefaz.al.gov.br/nfce/consulta', '2': 'www.sefaz.al.gov.br/nfce/consulta' },
  AM: { '1': 'www.sefaz.am.gov.br/nfce/consulta', '2': 'www.sefaz.am.gov.br/nfce/consulta' },
  AP: { '1': 'www.sefaz.ap.gov.br/nfce/consulta', '2': 'www.sefaz.ap.gov.br/nfce/consulta' },
  BA: { '1': 'http://www.sefaz.ba.gov.br/nfce/consulta', '2': 'http://hinternet.sefaz.ba.gov.br/nfce/consulta' },
  CE: { '1': 'www.sefaz.ce.gov.br/nfce/consulta', '2': 'www.sefaz.ce.gov.br/nfce/consulta' },
  DF: { '1': 'www.fazenda.df.gov.br/nfce/consulta', '2': 'www.fazenda.df.gov.br/nfce/consulta' },
  ES: { '1': 'www.sefaz.es.gov.br/nfce/consulta', '2': 'www.sefaz.es.gov.br/nfce/consulta' },
  GO: { '1': 'www.sefaz.go.gov.br/nfce/consulta', '2': 'www.nfce.go.gov.br/post/ver/214413/consulta-nfc-e-homologacao' },
  MA: { '1': 'www.sefaz.ma.gov.br/nfce/consulta', '2': 'www.sefaz.ma.gov.br/nfce/consulta' },
  MG: { '1': 'https://portalsped.fazenda.mg.gov.br/portalnfce', '2': 'https://hportalsped.fazenda.mg.gov.br/portalnfce' },
  MS: { '1': 'http://www.dfe.ms.gov.br/nfce/consulta', '2': 'http://www.dfe.ms.gov.br/nfce/consulta' },
  MT: { '1': 'http://www.sefaz.mt.gov.br/nfce/consultanfce', '2': 'http://homologacao.sefaz.mt.gov.br/nfce/consultanfce' },
  PA: { '1': 'www.sefa.pa.gov.br/nfce/consulta', '2': 'www.sefa.pa.gov.br/nfce/consulta' },
  PB: { '1': 'www.sefaz.pb.gov.br/nfce/consulta', '2': 'www.sefaz.pb.gov.br/nfcehom' },
  PE: { '1': 'nfce.sefaz.pe.gov.br/nfce/consulta', '2': 'nfce.sefaz.pe.gov.br/nfce/consulta' },
  PI: { '1': 'www.sefaz.pi.gov.br/nfce/consulta', '2': 'www.sefaz.pi.gov.br/nfce/consulta' },
  PR: { '1': 'http://www.fazenda.pr.gov.br/nfce/consulta', '2': 'http://www.fazenda.pr.gov.br/nfce/consulta' },
  RJ: { '1': 'www.fazenda.rj.gov.br/nfce/consulta', '2': 'www.fazenda.rj.gov.br/nfce/consulta' },
  RN: { '1': 'www.set.rn.gov.br/nfce/consulta', '2': 'www.set.rn.gov.br/nfce/consulta' },
  RO: { '1': 'www.sefin.ro.gov.br/nfce/consulta', '2': 'www.sefin.ro.gov.br/nfce/consulta' },
  RR: { '1': 'www.sefaz.rr.gov.br/nfce/consulta', '2': 'www.sefaz.rr.gov.br/nfce/consulta' },
  RS: { '1': 'www.sefaz.rs.gov.br/nfce/consulta', '2': 'www.sefaz.rs.gov.br/nfce/consulta' },
  SC: { '1': 'https://sat.sef.sc.gov.br/nfce/consulta', '2': 'https://hom.sat.sef.sc.gov.br/nfce/consulta' },
  SE: { '1': 'http://www.nfce.se.gov.br/nfce/consulta', '2': 'http://www.hom.nfe.se.gov.br/nfce/consulta' },
  SP: { '1': 'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica', '2': 'https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica' },
  TO: { '1': 'www.sefaz.to.gov.br/nfce/consulta', '2': 'http://homologacao.sefaz.to.gov.br/nfce/consulta.jsf' },
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
/**
 * O ST do grupo de ICMS, na ordem do XSD: modBCST, pMVAST, vBCST, pICMSST, vICMSST e o FCP do ST
 * (vBCFCPST, pFCPST, vFCPST).
 */
function adicionarST(group: Record<string, any>, icms: NFeItemImposto['icms']): void {
  if (icms.modBCST) group['modBCST'] = icms.modBCST;
  if (icms.mvaST !== undefined) group['pMVAST'] = formatarValor(icms.mvaST);
  if (icms.valorBCST !== undefined) group['vBCST'] = formatarValor(icms.valorBCST);
  if (icms.aliquotaST !== undefined) group['pICMSST'] = formatarValor(icms.aliquotaST);
  if (icms.valorST !== undefined) group['vICMSST'] = formatarValor(icms.valorST);
  if (icms.valorFCPST !== undefined && icms.valorFCPST > 0) {
    group['vBCFCPST'] = formatarValor(icms.valorBCFCPST ?? icms.valorBCST ?? 0);
    group['pFCPST'] = formatarValor(icms.aliquotaFCPST ?? 0);
    group['vFCPST'] = formatarValor(icms.valorFCPST);
  }
}

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
      adicionarST(group, icms);
    } else if (groupName === 'ICMSSN500') {
      if (icms.valorBCST !== undefined) group['vBCSTRet'] = formatarValor(icms.valorBCST);
      if (icms.valorST !== undefined) group['vICMSSTRet'] = formatarValor(icms.valorST);
    } else if (groupName === 'ICMSSN900') {
      if (icms.modBC) group['modBC'] = icms.modBC;
      if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
      if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
      if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
      adicionarST(group, icms);
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
        adicionarST(group, icms);
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
        adicionarST(group, icms);
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
        adicionarST(group, icms);
        break;
      case 'ICMS90':
        if (!icms.modBC) {
          throw new Error('Modalidade BC (modBC) obrigatória para CST 90');
        }
        group['modBC'] = icms.modBC;
        if (icms.valorBC !== undefined) group['vBC'] = formatarValor(icms.valorBC);
        if (icms.aliquota !== undefined) group['pICMS'] = formatarValor(icms.aliquota);
        if (icms.valor !== undefined) group['vICMS'] = formatarValor(icms.valor);
        adicionarST(group, icms);
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
    vFCPST += imp.icms.valorFCPST || 0;

    // PIS/COFINS
    vPIS += imp.pis.valor || 0;
    vCOFINS += imp.cofins.valor || 0;

    // IPI
    if (imp.ipi) {
      vIPI += imp.ipi.valor || 0;
    }
    vIPIDevol += item.impostoDevol?.valorIPIDevolvido || 0;
  }

  // vNF (NT 2016.002): vProd − vDesc + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol.
  const vNF = vProd + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol - vDesc;

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
    xLgr: truncar(endereco.logradouro, 60),
    nro: truncar(endereco.numero, 60),
  };
  if (endereco.complemento) end['xCpl'] = truncar(endereco.complemento, 60);
  end['xBairro'] = truncar(endereco.bairro, 60);
  end['cMun'] = endereco.codigoMunicipio;
  end['xMun'] = truncar(endereco.municipio, 60);
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
  /** NFref — referências a NF-e anteriores (devolução, complemento, ajuste). */
  referencias?: NFeReference[];
  /** Contingência off-line (tpEmis=9): obriga dhCont + xJust no <ide>. */
  dhCont?: string;
  xJust?: string;
}): Record<string, any> {
  const ide: Record<string, any> = {
    cUF: params.cUF,
    cNF: params.cNF,
    natOp: truncar(params.natOp, 60),
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

  // NFref: no XSD 4.00 (TIde) o grupo fica entre cMunFG (B12) e tpImp (B21).
  // 0..500 ocorrências; xmlbuilder2 serializa arrays como tags repetidas.
  // (Posição errada aqui = rejeição 225 em toda devolução/complementar.)
  if (params.referencias && params.referencias.length > 0) {
    ide['NFref'] = params.referencias.map((ref) => ({
      refNFe: apenasNumeros(ref.refNFe),
    }));
  }

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

  // dhCont + xJust: obrigatórios quando tpEmis indica contingência (4, 5, 6, 7, 9).
  // São os ÚLTIMOS elementos do <ide> no XSD 4.00.
  if (params.dhCont) ide['dhCont'] = params.dhCont;
  if (params.xJust) ide['xJust'] = params.xJust;

  return ide;
}

/**
 * Constroi o grupo <emit> (emitente)
 */
function buildEmitenteGroup(emitente: NFeEmitente): Record<string, any> {
  const emit: Record<string, any> = {
    CNPJ: apenasNumeros(emitente.cnpj),
    xNome: truncar(emitente.nome, 60),
  };

  if (emitente.nomeFantasia) {
    emit['xFant'] = truncar(emitente.nomeFantasia, 60);
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
  destGroup['xNome'] = tpAmb === '2' ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : truncar(dest.nome, 60);

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
    // cEAN/cEANTrib são OBRIGATÓRIOS no XSD 4.00 (rejeição 225 se omitidos);
    // sem GTIN o valor literal exigido é 'SEM GTIN'. uTrib/qTrib/vUnTrib
    // ausentes espelham a unidade comercial (caso comum: sem conversão).
    const cEAN = (item.produto.cEAN ?? '').trim() || 'SEM GTIN';
    const cEANTrib = (item.produto.cEANTrib ?? '').trim() || 'SEM GTIN';
    // unidadeTrib é string — '' não cai no fallback com ?? (como cEAN acima),
    // então usar || após trim para espelhar uCom quando vier vazia.
    const uTrib = (item.produto.unidadeTrib ?? '').trim() || item.produto.unidade;
    const qTrib = item.produto.quantidadeTrib ?? item.produto.quantidade;
    const vUnTrib = item.produto.valorUnitarioTrib ?? item.produto.valorUnitario;

    const prod: Record<string, any> = {
      cProd: item.produto.codigo,
      cEAN,
      xProd: truncar(item.produto.descricao, 120),
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
    prod['cEANTrib'] = cEANTrib;
    prod['uTrib'] = uTrib;
    prod['qTrib'] = formatarValor(qTrib, 4);
    prod['vUnTrib'] = formatarValor(vUnTrib, 10);

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

    const det: Record<string, any> = {
      '@nItem': String(item.numero),
      prod,
      imposto: impostoGroup,
    };
    // impostoDevol vem depois de <imposto> (e antes de infAdProd).
    if (item.impostoDevol) {
      det['impostoDevol'] = {
        pDevol: formatarValor(item.impostoDevol.percentualDevolvido),
        IPI: { vIPIDevol: formatarValor(item.impostoDevol.valorIPIDevolvido) },
      };
    }
    return det;
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
    };
    // xPag é obrigatório quando tPag=99 (Outros) — sem ele a SEFAZ rejeita
    // por schema. Ordem do XSD: tPag -> xPag -> vPag.
    if (forma.tipo === '99') {
      detPag['xPag'] = truncar(forma.descricao || 'Outros', 60);
    }
    detPag['vPag'] = formatarValor(forma.valor);

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
 * Gera o QR Code v3 (NT 2025.001) para NFCe em emissão ONLINE:
 * url?p=chNFe|3|tpAmb — sem CSC, sem hash. O leiaute off-line (tpEmis=9,
 * com assinatura RSA) vive em buildNFCeSuplContingencia.
 */
function gerarQRCodeNFCe(params: {
  chNFe: string;
  tpAmb: '1' | '2';
  uf: string;
}): { qrCodeUrl: string; urlChave: string } {
  const { chNFe, tpAmb, uf } = params;

  const urlQRCode = NFCE_QRCODE_URL[uf.toUpperCase()]?.[tpAmb];
  if (!urlQRCode) {
    throw new Error(`URL de QR Code não encontrada para UF: ${uf}, ambiente: ${tpAmb}`);
  }

  const qrCodeUrl = `${urlQRCode}?p=${chNFe}|3|${tpAmb}`;

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
    referencias: request.referencias,
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
      infAdic['infCpl'] = truncar(request.informacoesAdicionais.contribuinte, 5000);
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

  // Contingência off-line: tpEmis=9 + dhCont + xJust. SEFAZ aceita transmissão
  // até 24h após dhCont — o XML é assinado agora, transmitido depois.
  const isContingencia = !!request.contingencia;
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
    tpEmis: isContingencia ? '9' : '1', // 9=Contingência off-line NFCe
    cDV,
    tpAmb,
    finNFe: '1', // 1=Normal
    indFinal: '1', // 1=Consumidor final (NFCe sempre)
    indPres: '1', // 1=Presencial
    procEmi: '0',
    verProc: 'SefazAPI-1.0',
    dhCont: request.contingencia?.dhCont,
    xJust: request.contingencia?.xJust,
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
        : truncar(request.consumidor.nome, 60); // xNome max 60 (era cru em produção)
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
      infCpl: truncar(request.informacoesAdicionais.contribuinte, 5000),
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
  // CSC mantido na assinatura por compatibilidade de chamada — o QR v3
  // online (NT 2025.001) não usa mais CSC/hash.
  _csc: { id: string; token: string },
  uf: string,
): string {
  const qrCode = gerarQRCodeNFCe({
    chNFe: chaveAcesso,
    tpAmb,
    uf,
  });

  return `<infNFeSupl><qrCode>${qrCode.qrCodeUrl}</qrCode><urlChave>${qrCode.urlChave}</urlChave></infNFeSupl>`;
}

/**
 * Gera o fragmento infNFeSupl para NFC-e em contingência OFF-LINE (tpEmis=9).
 *
 * O QR Code é OBRIGATÓRIO também em contingência — infNFeSupl é grupo
 * obrigatório do modelo 65 e a transmissão posterior é rejeitada por schema
 * sem ele. Usa QR Code versão 3 (NT 2025.001 — obrigatório em produção desde
 * 01/09/2025, inclusive para contingência). Leiaute off-line:
 *
 *   url?p=chNFe|3|tpAmb|diaDhEmi|vNF|tpIdDest|cDest|assinatura
 *
 * - diaDhEmi: dia (DD) extraído literalmente do dhEmi do XML (sem conversão
 *   de fuso — o dhEmi já carrega o offset do emitente)
 * - vNF: 2 casas decimais, ponto decimal, sem separador de milhar
 * - tpIdDest|cDest: 1=CNPJ, 2=CPF (3=idEstrangeiro não se aplica a esta
 *   NFC-e); AMBOS VAZIOS quando o consumidor não é identificado — os pipes
 *   permanecem (campos vazios), espelhando o grupo dest do XML
 * - assinatura: RSA-SHA1 sobre a string "chNFe|3|tpAmb|dia|vNF|tpIdDest|cDest"
 *   (exatamente os 7 campos antes dela, sem a URL) com a CHAVE PRIVADA do
 *   certificado do emitente, codificada em base64 padrão, SEM url-encode
 *
 * CSC, idCSC, hash SHA-1 e digVal SAÍRAM do leiaute v3 — a autenticidade é
 * garantida pela assinatura digital dos parâmetros.
 *
 * Referências cruzadas (código verbatim conferido em 2026-06):
 * - sped-nfe QRCode::get300 (ramo tpEmis==9):
 *     base64_encode($certificate->sign("$chNFe|3|$tpAmb|$dia|$valor|$tp_idDest|$cDest"))
 *   com Certificate::sign($content, $algorithm = OPENSSL_ALGO_SHA1).
 * - ACBr TACBrNFe.GetURLQRCodeV3 (ramo tpEmis=9):
 *     sEntrada := sEntrada + '|' + SSL.CalcHash(sEntrada, dgstSHA1, outBase64, True)
 *   (CalcHash com Assina=True = assinatura RSA do digest SHA-1, saída base64).
 * Divergência entre as referências: para idEstrangeiro (tpIdDest=3) o
 * sped-nfe esvazia cDest e o ACBr mantém o idEstrangeiro — irrelevante aqui
 * porque o consumidor da NFC-e só tem CPF/CNPJ.
 */
export function buildNFCeSuplContingencia(params: {
  chaveAcesso: string;
  tpAmb: '1' | '2';
  uf: string;
  /** dhEmi exatamente como está no XML (YYYY-MM-DDThh:mm:ssTZD). */
  dhEmi: string;
  /** vNF exatamente como está no ICMSTot do XML. */
  vNF: string;
  /** Certificado do emitente — a chave privada assina os parâmetros do QR. */
  certificado: CertificateData;
  /** Consumidor identificado (CPF/CNPJ), se houver — mesmo critério do dest do XML. */
  consumidor?: { cpf?: string; cnpj?: string };
}): string {
  const { chaveAcesso, tpAmb, uf, dhEmi, vNF, certificado, consumidor } = params;

  const urlQRCode = NFCE_QRCODE_URL[uf.toUpperCase()]?.[tpAmb];
  if (!urlQRCode) {
    throw new Error(`URL de QR Code não encontrada para UF: ${uf}, ambiente: ${tpAmb}`);
  }

  const diaMatch = dhEmi.match(/^\d{4}-\d{2}-(\d{2})T/);
  if (!diaMatch) {
    throw new Error(`dhEmi inválido para QR Code de contingência: ${dhEmi}`);
  }
  const dia = diaMatch[1];

  const valorNum = Number(vNF);
  if (!Number.isFinite(valorNum)) {
    throw new Error(`vNF inválido para QR Code de contingência: ${vNF}`);
  }
  const valor = valorNum.toFixed(2);

  // Mesma precedência de buildNFCeXml (CNPJ antes de CPF) pra manter o QR
  // coerente com o grupo dest do XML — a SEFAZ cruza os dois na recepção.
  let tpIdDest = '';
  let cDest = '';
  const cnpjDest = consumidor?.cnpj ? apenasNumeros(consumidor.cnpj) : '';
  const cpfDest = consumidor?.cpf ? apenasNumeros(consumidor.cpf) : '';
  if (cnpjDest) {
    tpIdDest = '1';
    cDest = cnpjDest;
  } else if (cpfDest) {
    tpIdDest = '2';
    cDest = cpfDest;
  }

  const seq = `${chaveAcesso}|3|${tpAmb}|${dia}|${valor}|${tpIdDest}|${cDest}`;

  const { privateKey } = parsePfx(certificado.pfxBase64, certificado.password);
  const assinatura = crypto.createSign('RSA-SHA1').update(seq, 'utf8').sign(privateKey, 'base64');

  const qrCodeUrl = `${urlQRCode}?p=${seq}|${assinatura}`;

  const urlChave = NFCE_CONSULTA_URL[uf.toUpperCase()]?.[tpAmb] || urlQRCode;

  return `<infNFeSupl><qrCode>${qrCodeUrl}</qrCode><urlChave>${urlChave}</urlChave></infNFeSupl>`;
}
