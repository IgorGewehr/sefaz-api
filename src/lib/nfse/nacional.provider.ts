// ============================================================
// NacionalProvider — NFS-e via API REST da SEFIN Nacional
// (Ambiente de Dados Nacional / Padrão Nacional NFS-e)
//
// Protocolo: HTTPS REST com mTLS (certificado A1)
// Payload:   { "dpsXmlGZipB64": "<XML assinado → GZip → Base64>" }
//
// Esteira: XML DPS → Assinar <infDPS> → GZip → Base64 → JSON POST
// ============================================================

import * as https from 'https';
import * as zlib from 'zlib';
import { create } from 'xmlbuilder2';
import type { INfseProvider } from './provider.interface';
import type { CertificateData } from '../../types';
import type {
  NfseEmitirRequest,
  NfseCancelarRequest,
  NfseConsultarNfseRequest,
  NfseResponse,
  NfseMensagemRetorno,
} from '../../types/nfse';
import { getAdnEndpoints } from './nfse-endpoints';
import { assinarXml } from '../sefaz/xml-signer';
import { getCaBundle, tlsRejectUnauthorized } from '../sefaz/ca-bundle';
import { pfxToBuffer, apenasNumeros, formatarValor, formatarDataSefaz } from '../utils';
import { config } from '../../config';

// ============================================================
// Namespace do DPS (Padrão Nacional)
// ============================================================

const DPS_NS = 'http://www.sped.fazenda.gov.br/nfse';

// ============================================================
// HTTP Client com mTLS
// ============================================================

async function httpRequest(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  certificado: CertificateData,
  body?: object,
): Promise<{ status: number; data: any; raw: string }> {
  let pfx: Buffer;
  try {
    pfx = pfxToBuffer(certificado.pfxBase64);
  } catch (err: any) {
    throw new Error(`Falha ao decodificar certificado PFX: ${err.message}`);
  }

  let agent: https.Agent;
  try {
    agent = new https.Agent({
      pfx,
      passphrase: certificado.password,
      ca: getCaBundle(),
      rejectUnauthorized: tlsRejectUnauthorized(),
      minVersion: 'TLSv1.2',
    });
  } catch (err: any) {
    throw new Error(`Falha ao criar Agent mTLS: ${err.message}`);
  }

  let payload: string | undefined;
  try {
    payload = body ? JSON.stringify(body) : undefined;
  } catch (err: any) {
    throw new Error(`Falha ao serializar payload para JSON: ${err.message}`);
  }

  const urlObj = new URL(url);

  const options: https.RequestOptions = {
    hostname: urlObj.hostname,
    port: 443,
    path: urlObj.pathname + urlObj.search,
    method,
    agent,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'Accept': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload, 'utf-8') } : {}),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk: string) => { raw += chunk; });
      res.on('end', () => {
        let data: any = null;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          data = { rawBody: raw };
        }
        resolve({ status: res.statusCode || 0, data, raw });
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Erro de conexão com SEFIN: ${err.message}`));
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout na conexão com SEFIN (60s)'));
    });

    if (payload) req.write(payload);
    req.end();
  });
}

// ============================================================
// XML Builder: NfseEmitirRequest → XML DPS
//
// SEQUÊNCIA ESTRITA conforme XSD do Sefin Nacional v1.00:
//
// <DPS versao="1.00">
//   <infDPS Id="DPS...">
//     1.  tpAmb
//     2.  dhEmi
//     3.  verAplic
//     4.  serie
//     5.  nDPS
//     6.  dCompet
//     7.  tpEmit
//     8.  cLocEmi
//     9.  subst?        (substituição — não implementado)
//     10. prest
//         └─ CNPJ, IM, regTrib{opSimpNac, regApTribSN?, regEspTrib}
//     11. toma
//         └─ CNPJ|CPF, xNome, end?, email?, fone?, IM?
//     12. interm?       (intermediário — não implementado)
//     13. serv
//         └─ locPrest{cLocPrestacao, cPaisPrestacao?}
//         └─ cServ{cTribNac, cTribMun?, CNAE?, xDescServ, cNBS?}
//     14. valores
//         └─ vServPrest{vReceb, vServ}
//         └─ vDescIncond?, vDescCond?, vDed?
//         └─ trib
//            └─ tribMun{tribISSQN, cPaisResult?, pAliq, tpRetISSQN}
//               OU tribMunSN{tribISSQN, tpRetISSQN}  ← Simples Nacional
//            └─ totTrib{vTotTribFed?, vTotTribEst?, vTotTribMun?}
//     15. infCompl?
//   </infDPS>
// </DPS>
//
// REGRA SIMPLES NACIONAL:
//   Quando opSimpNac=1, usa-se <tribMunSN> em vez de <tribMun>.
//   <tribMunSN> contém APENAS tribISSQN + tpRetISSQN (sem pAliq).
//   O governo calcula alíquota e ISS internamente pelo DAS.
// ============================================================

// ── Id do DPS ── TSIdDPS: "DPS"(3) + 42 dígitos = 45 chars
// Composição: DPS + cLocEmi(7) + tpInsc(1 díg, "2"=CNPJ) + CNPJ(14) + serie(5) + nDPS(15)
// Mesmo Id usado na infDPS da emissão e no GET /dps/{idDps} da SEFIN —
// helper compartilhado para a derivação nunca divergir entre os dois fluxos.
export function montarIdDps(params: {
  codigoMunicipio: string;
  cnpj: string;
  serie: string;
  numero: number | string;
}): string {
  // Série: ADN exige valor numérico. Legados alfanuméricos → "1"
  const serieNumerica = /^\d+$/.test(params.serie) ? params.serie : '1';
  const cLocEmi = apenasNumeros(params.codigoMunicipio).padStart(7, '0');
  const cnpj = apenasNumeros(params.cnpj).padStart(14, '0');
  return `DPS${cLocEmi}2${cnpj}${serieNumerica.padStart(5, '0')}${String(params.numero).padStart(15, '0')}`;
}

// ============================================================
// DPS do Padrão Nacional — leiaute 1.01 (Sefin Nacional)
//
// Conferido contra os XSD oficiais (gov.br/nfse): o vigente em produção
// (nfse-esquemas_xsd-v1-01-20260209) e o da NT 009 (produção restrita,
// esquemas_prod_restrita_20261020). Diferenças para uma nota comum:
//   - NT 009: <finNFSe>0</finNFSe> obrigatório no infDPS (o vigente não aceita);
//   - NT 009: <cNBS> antes de <xDescServ> (no vigente, depois).
// Códigos do padrão nacional (NÃO os da ABRASF):
//   opSimpNac: 1=Não optante, 2=MEI, 3=ME/EPP
//   regApTribSN (só com opSimpNac=3): 1=tudo pelo SN, 2=federais pelo SN e ISSQN fora, 3=nenhum pelo SN
//   regEspTrib: 0=Nenhum (padrão), 1=Cooperativa, 2=Estimativa, 3=ME municipal,
//               4=Notário, 5=Autônomo, 6=Sociedade de profissionais, 9=Outros
//               (ver regEspTribNacional: o campo antigo regEspTrib tinha outra numeração)
// ============================================================

export type LeiauteDps = 'vigente' | 'nt009';

/** O leiaute da DPS: o pedido, a variável NFSE_LEIAUTE, ou NT 009 na homologação e vigente na produção. */
export function leiauteDps(request: NfseEmitirRequest): LeiauteDps {
  const pedido = request.leiauteDps;
  const env = (process.env.NFSE_LEIAUTE || '').trim().toLowerCase();
  const escolhido = pedido || env;
  if (escolhido === 'nt009' || escolhido === 'vigente') return escolhido;
  const ambiente = request.ambiente || config.sefazAmbiente;
  return ambiente === 'producao' ? 'vigente' : 'nt009';
}

/** O texto como o TSString do XSD aceita: só U+0020..U+00FF, sem espaço nas pontas. */
export function textoXsd(s: string | undefined, max: number, quebras = false): string | undefined {
  if (!s) return undefined;
  const trocado = s
    .replace(/[–—−•·]/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, '...')
    .replace(/\r\n?/g, quebras ? '\n' : ' ')
    .replace(quebras ? /[\t   ]/g : /[\t\n   ]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(quebras ? /[^\n\x20-\x7E\xA1-\xFF]/g : /[^\x20-\x7E\xA1-\xFF]/g, '');
  const limpo = Array.from(trocado.trim()).slice(0, max).join('').trimEnd();
  return limpo || undefined;
}

/** opSimpNac do padrão nacional. */
export function opSimpNac(p: NfseEmitirRequest['prestador']): '1' | '2' | '3' {
  if (!p.optanteSimplesNacional) return '1';
  return p.mei || p.regimeEspecialTributacao === '5' ? '2' : '3';
}

/**
 * regEspTrib do padrão nacional. `regEspTribNacional` é o código nacional como está. O
 * `regEspTrib` segue o contrato antigo deste serviço (0=sem regime, 1=cooperativa, 2=estimativa,
 * 3=MEI, 4=notário, 5=autônomo, 6=nenhum): 3 e 6 viram 0 (no nacional, 3 é "microempresa
 * municipal" e 6 "sociedade de profissionais"; o MEI vai no opSimpNac).
 */
export function regEspTribNacional(p: NfseEmitirRequest['prestador']): string {
  const validos = [0, 1, 2, 3, 4, 5, 6, 9];
  if (p.regEspTribNacional !== undefined && validos.includes(p.regEspTribNacional)) {
    return String(p.regEspTribNacional);
  }
  const antigo = p.regEspTrib;
  if (antigo === 1 || antigo === 2 || antigo === 4 || antigo === 5) return String(antigo);
  return '0';
}

export function buildDpsXmlNacional(request: NfseEmitirRequest, leiaute: LeiauteDps = leiauteDps(request)): string {
  const ns = DPS_NS;
  const cnpj = apenasNumeros(request.prestador.cnpj);
  const v = request.valores;
  const ambienteEfetivo = request.ambiente || config.sefazAmbiente;
  const op = opSimpNac(request.prestador);
  const cTribNac = request.servico.codigoTributacaoNacional
    || request.servico.codigoServico.replace(/\D/g, '').padEnd(6, '0');
  const serieNumerica = /^\d+$/.test(request.rps.serie) ? String(Number(request.rps.serie)) : '1';
  const cLocEmi = apenasNumeros(request.prestador.endereco?.codigoMunicipio || request.servico.codigoMunicipioPrestacao);
  if (v.valorDeducoes) {
    throw new Error('Deduções/reduções da base (vDedRed/vAjusteBC) ainda não são suportadas na DPS do padrão nacional');
  }
  const id = montarIdDps({ codigoMunicipio: cLocEmi, cnpj, serie: serieNumerica, numero: request.rps.numero });

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const dps = doc.ele(ns, 'DPS').att('versao', '1.01');
  const inf = dps.ele(ns, 'infDPS').att('Id', id);
  inf.ele(ns, 'tpAmb').txt(ambienteEfetivo === 'producao' ? '1' : '2');
  inf.ele(ns, 'dhEmi').txt(formatarDataSefaz(new Date(Date.now() - 60_000)));
  inf.ele(ns, 'verAplic').txt('sefaz-api-1.01');
  inf.ele(ns, 'serie').txt(serieNumerica);
  inf.ele(ns, 'nDPS').txt(String(Number(request.rps.numero)));
  inf.ele(ns, 'dCompet').txt(request.rps.dataEmissao);
  inf.ele(ns, 'tpEmit').txt('1');
  if (leiaute === 'nt009') inf.ele(ns, 'finNFSe').txt('0');
  inf.ele(ns, 'cLocEmi').txt(cLocEmi);

  // Prestador emitente: nome e endereço vêm do cadastro nacional.
  const prest = inf.ele(ns, 'prest');
  prest.ele(ns, 'CNPJ').txt(cnpj);
  const im = textoXsd(request.prestador.inscricaoMunicipal, 15);
  if (im) prest.ele(ns, 'IM').txt(im);
  const regTrib = prest.ele(ns, 'regTrib');
  regTrib.ele(ns, 'opSimpNac').txt(op);
  if (op === '3') {
    const ap = request.prestador.regApTribSN;
    regTrib.ele(ns, 'regApTribSN').txt(String(ap === 2 || ap === 3 ? ap : 1));
  }
  regTrib.ele(ns, 'regEspTrib').txt(regEspTribNacional(request.prestador));

  // Tomador — ordem do XSD: CNPJ|CPF, IM?, xNome, end?, fone?, email?
  const doc_toma = apenasNumeros(request.tomador.cnpj || request.tomador.cpf || '');
  if (doc_toma) {
    const toma = inf.ele(ns, 'toma');
    toma.ele(ns, doc_toma.length === 14 ? 'CNPJ' : 'CPF').txt(doc_toma);
    const imToma = textoXsd(request.tomador.inscricaoMunicipal, 15);
    if (imToma) toma.ele(ns, 'IM').txt(imToma);
    toma.ele(ns, 'xNome').txt(textoXsd(request.tomador.nome, 300) || 'CONSUMIDOR');
    const e = request.tomador.endereco;
    const cMun = apenasNumeros(e?.codigoMunicipio || '');
    const cep = apenasNumeros(e?.cep || '');
    const lgr = textoXsd(e?.logradouro, 255);
    const bairro = textoXsd(e?.bairro, 60);
    if (e && cMun.length === 7 && cep.length === 8 && lgr && bairro) {
      const end = toma.ele(ns, 'end');
      const endNac = end.ele(ns, 'endNac');
      endNac.ele(ns, 'cMun').txt(cMun);
      endNac.ele(ns, 'CEP').txt(cep);
      end.ele(ns, 'xLgr').txt(lgr);
      end.ele(ns, 'nro').txt(textoXsd(e.numero, 60) || 'S/N');
      const cpl = textoXsd(e.complemento, 156);
      if (cpl) end.ele(ns, 'xCpl').txt(cpl);
      end.ele(ns, 'xBairro').txt(bairro);
    }
    const fone = apenasNumeros(request.tomador.contato?.telefone || '');
    if (fone.length >= 6 && fone.length <= 20) toma.ele(ns, 'fone').txt(fone);
    const email = (request.tomador.contato?.email || '').trim();
    if (email.includes('@') && email.length <= 80) toma.ele(ns, 'email').txt(email);
  }

  // Serviço — cServ: cTribNac, cTribMun?, (NT 009: cNBS?, xDescServ | vigente: xDescServ, cNBS?)
  const serv = inf.ele(ns, 'serv');
  serv.ele(ns, 'locPrest').ele(ns, 'cLocPrestacao').txt(apenasNumeros(request.servico.codigoMunicipioPrestacao));
  const cServ = serv.ele(ns, 'cServ');
  cServ.ele(ns, 'cTribNac').txt(cTribNac);
  const cTribMun = apenasNumeros(request.servico.codigoTributacaoMunicipio || '');
  if (cTribMun) cServ.ele(ns, 'cTribMun').txt(cTribMun);
  const nbs = apenasNumeros(request.servico.nbs || '');
  const desc = textoXsd(request.servico.discriminacao, 2000, true) || 'Servico prestado';
  if (leiaute === 'nt009') {
    if (nbs) cServ.ele(ns, 'cNBS').txt(nbs);
    cServ.ele(ns, 'xDescServ').txt(desc);
  } else {
    cServ.ele(ns, 'xDescServ').txt(desc);
    if (nbs) cServ.ele(ns, 'cNBS').txt(nbs);
  }
  const infCompl = textoXsd(request.informacoesComplementares, 2000);
  if (infCompl) serv.ele(ns, 'infoCompl').ele(ns, 'xInfComp').txt(infCompl);

  // Valores — vServPrest{vServ}, vDescCondIncond{vDescIncond?, vDescCond?}, trib
  const valores = inf.ele(ns, 'valores');
  valores.ele(ns, 'vServPrest').ele(ns, 'vServ').txt(formatarValor(v.valorServicos));
  if (v.descontoIncondicionado || v.descontoCondicionado) {
    const desc = valores.ele(ns, 'vDescCondIncond');
    if (v.descontoIncondicionado) desc.ele(ns, 'vDescIncond').txt(formatarValor(v.descontoIncondicionado));
    if (v.descontoCondicionado) desc.ele(ns, 'vDescCond').txt(formatarValor(v.descontoCondicionado));
  }
  const trib = valores.ele(ns, 'trib');
  const tribMun = trib.ele(ns, 'tribMun');
  const tribISSQN = request.servico.idTribMun || '1';
  tribMun.ele(ns, 'tribISSQN').txt(tribISSQN);
  if (tribISSQN === '3' && request.servico.codigoPaisPrestacao) {
    tribMun.ele(ns, 'cPaisResult').txt(request.servico.codigoPaisPrestacao);
  }
  tribMun.ele(ns, 'tpRetISSQN').txt(v.issRetido ? '2' : '1');
  if (op === '1') tribMun.ele(ns, 'pAliq').txt(formatarValor(v.aliquotaIss * 100, 2));
  const totTrib = trib.ele(ns, 'totTrib');
  if (op === '3' && v.aliquotaIss > 0) {
    totTrib.ele(ns, 'pTotTribSN').txt(formatarValor(v.aliquotaIss * 100, 2));
  } else {
    totTrib.ele(ns, 'indTotTrib').txt('0');
  }
  return doc.end({ prettyPrint: false });
}

export function buildDpsXml(request: NfseEmitirRequest, ns: string = DPS_NS): string {
  if (ns === DPS_NS) return buildDpsXmlNacional(request);
  const cnpj = apenasNumeros(request.prestador.cnpj);
  const v = request.valores;
  const ambienteEfetivo = request.ambiente || config.sefazAmbiente;
  const tpAmb = ambienteEfetivo === 'producao' ? '1' : '2';
  const isSimples = request.prestador.optanteSimplesNacional;

  const cTribNac = request.servico.codigoTributacaoNacional
    || request.servico.codigoServico.replace(/\D/g, '').padEnd(6, '0');

  // Série: ADN exige valor numérico. Legados alfanuméricos → "1"
  const serieNumerica = /^\d+$/.test(request.rps.serie) ? request.rps.serie : '1';

  const infDpsId = montarIdDps({
    codigoMunicipio: request.servico.codigoMunicipioPrestacao,
    cnpj,
    serie: serieNumerica,
    numero: request.rps.numero,
  });

  // ADN (SEFAZ) usa 'Id' maiúsculo (padrão XML Signature)
  // Betha Cloud usa 'id' minúsculo (conforme XSD próprio)
  const idAttrName = ns === DPS_NS ? 'Id' : 'id';

  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  // ══════════════════════════════════════════════════════════
  // <DPS versao="1.00">
  // ══════════════════════════════════════════════════════════
  const dps = doc.ele(ns, 'DPS').att('versao', '1.00');
  const inf = dps.ele(ns, 'infDPS').att(idAttrName, infDpsId);

  // ── 1-8: Identificação (ordem fixa) ──
  inf.ele(ns, 'tpAmb').txt(tpAmb);                                    // 1
  inf.ele(ns, 'dhEmi').txt(formatarDataSefaz());                      // 2
  inf.ele(ns, 'verAplic').txt('sefaz-api-1.0');                       // 3
  inf.ele(ns, 'serie').txt(serieNumerica);                            // 4
  inf.ele(ns, 'nDPS').txt(String(request.rps.numero));                // 5
  inf.ele(ns, 'dCompet').txt(request.rps.dataEmissao);                // 6
  inf.ele(ns, 'tpEmit').txt('1');                                     // 7
  inf.ele(ns, 'cLocEmi').txt(request.servico.codigoMunicipioPrestacao); // 8

  // ── 10: Prestador ──
  const prest = inf.ele(ns, 'prest');
  prest.ele(ns, 'CNPJ').txt(cnpj);
  prest.ele(ns, 'IM').txt(request.prestador.inscricaoMunicipal);

  // regTrib: opSimpNac → regApTribSN? → regEspTrib (ordem fixa)
  const regTrib = prest.ele(ns, 'regTrib');
  regTrib.ele(ns, 'opSimpNac').txt(isSimples ? '1' : '2');
  if (isSimples) {
    regTrib.ele(ns, 'regApTribSN').txt(String(request.prestador.regApTribSN ?? 2));
  }
  regTrib.ele(ns, 'regEspTrib').txt(String(request.prestador.regEspTrib ?? 6));

  // ── 11: Tomador ──
  const toma = inf.ele(ns, 'toma');

  // XSD: CNPJ|CPF → xNome → end? → email? → fone? → IM?
  if (request.tomador.cnpj) {
    toma.ele(ns, 'CNPJ').txt(apenasNumeros(request.tomador.cnpj));
  } else if (request.tomador.cpf) {
    toma.ele(ns, 'CPF').txt(apenasNumeros(request.tomador.cpf));
  }
  toma.ele(ns, 'xNome').txt(request.tomador.nome);

  if (request.tomador.endereco) {
    // XSD end: (endNac{cMun, CEP} | endExt) → xLgr → nro → xCpl? → xBairro
    // endNac vem PRIMEIRO, logradouro vem DEPOIS como irmão
    const end = toma.ele(ns, 'end');
    const endNac = end.ele(ns, 'endNac');
    endNac.ele(ns, 'cMun').txt(request.tomador.endereco.codigoMunicipio);
    endNac.ele(ns, 'CEP').txt(apenasNumeros(request.tomador.endereco.cep));
    end.ele(ns, 'xLgr').txt(request.tomador.endereco.logradouro || 'NAO INFORMADO');
    end.ele(ns, 'nro').txt(request.tomador.endereco.numero || 'SN');
    if (request.tomador.endereco.complemento) {
      end.ele(ns, 'xCpl').txt(request.tomador.endereco.complemento);
    }
    end.ele(ns, 'xBairro').txt(request.tomador.endereco.bairro || 'NAO INFORMADO');
  }

  if (request.tomador.contato?.email) {
    toma.ele(ns, 'email').txt(request.tomador.contato.email);
  }
  if (request.tomador.contato?.telefone) {
    toma.ele(ns, 'fone').txt(apenasNumeros(request.tomador.contato.telefone));
  }
  if (request.tomador.inscricaoMunicipal) {
    toma.ele(ns, 'IM').txt(request.tomador.inscricaoMunicipal);
  }

  // ── 13: Serviço ──
  const serv = inf.ele(ns, 'serv');

  // locPrest: cLocPrestacao → cPaisPrestacao? (só exterior)
  const locPrest = serv.ele(ns, 'locPrest');
  locPrest.ele(ns, 'cLocPrestacao').txt(request.servico.codigoMunicipioPrestacao);
  if (request.servico.codigoMunicipioPrestacao === '9999999') {
    locPrest.ele(ns, 'cPaisPrestacao').txt(request.servico.codigoPaisPrestacao || '1058');
  }

  // cServ: cTribNac → cTribMun? → CNAE? → xDescServ → cNBS?
  // Betha Cloud: cNBS é obrigatório no schema (diferente do ADN onde é opcional)
  const isBethaSchema = ns !== DPS_NS;
  const cServ = serv.ele(ns, 'cServ');
  cServ.ele(ns, 'cTribNac').txt(cTribNac);
  if (request.servico.codigoTributacaoMunicipio) {
    cServ.ele(ns, 'cTribMun').txt(request.servico.codigoTributacaoMunicipio);
  }
  if (request.servico.cnae) {
    cServ.ele(ns, 'CNAE').txt(request.servico.cnae);
  }
  cServ.ele(ns, 'xDescServ').txt(request.servico.discriminacao);
  if (request.servico.nbs) {
    // NBS deve ser 9 dígitos numéricos (TCodigoNBS). Remove pontos/separadores.
    // Formato de entrada: "1.0101.00.00" → "101010000" (9 dígitos)
    const nbsDigitos = request.servico.nbs.replace(/\D/g, '');
    if (isBethaSchema && nbsDigitos.length !== 9) {
      throw new Error(`Código NBS inválido: "${request.servico.nbs}" → "${nbsDigitos}" deve ter exatamente 9 dígitos. Use o formato X.XXXX.XX.XX (ex: "1.0101.00.00").`);
    }
    cServ.ele(ns, 'cNBS').txt(nbsDigitos);
  } else if (isBethaSchema) {
    throw new Error('Campo nbs (Código NBS) é obrigatório para emissão via Betha Cloud. Use o formato X.XXXX.XX.XX (ex: "1.0101.00.00").');
  }

  // ── 14: Valores ──
  const valores = inf.ele(ns, 'valores');

  // vServPrest: vReceb → vServ
  const vServPrest = valores.ele(ns, 'vServPrest');
  vServPrest.ele(ns, 'vReceb').txt(formatarValor(v.valorServicos));
  vServPrest.ele(ns, 'vServ').txt(formatarValor(v.valorServicos));

  // Descontos e deduções (opcionais, ordem: vDescIncond → vDescCond → vDed)
  if (v.descontoIncondicionado) {
    valores.ele(ns, 'vDescIncond').txt(formatarValor(v.descontoIncondicionado));
  }
  if (v.descontoCondicionado) {
    valores.ele(ns, 'vDescCond').txt(formatarValor(v.descontoCondicionado));
  }
  if (v.valorDeducoes) {
    valores.ele(ns, 'vDed').txt(formatarValor(v.valorDeducoes));
  }

  // ── Tributação ──
  const trib = valores.ele(ns, 'trib');
  const tribISSQN = request.servico.idTribMun || '1';

  if (isSimples) {
    // ═══ SIMPLES NACIONAL → <tribMun> sem pAliq ═══
    // Não envia pAliq, vBC, vISSQN — governo calcula pelo DAS
    // XSD: tribISSQN → tpRetISSQN
    const tribMun = trib.ele(ns, 'tribMun');
    tribMun.ele(ns, 'tribISSQN').txt(tribISSQN);
    // tpRetISSQN (layout nacional): 1=Não Retido, 2=Retido pelo Tomador
    tribMun.ele(ns, 'tpRetISSQN').txt(v.issRetido ? '2' : '1');
  } else {
    // ═══ REGIME NORMAL → <tribMun> ═══
    // XSD tribMun: tribISSQN → cPaisResult? → pAliq → tpRetISSQN
    const tribMun = trib.ele(ns, 'tribMun');
    tribMun.ele(ns, 'tribISSQN').txt(tribISSQN);
    if (tribISSQN === '3' && request.servico.codigoPaisPrestacao) {
      tribMun.ele(ns, 'cPaisResult').txt(request.servico.codigoPaisPrestacao);
    }
    // pAliq é TSDec1V2 no XSD 1.00 (tiposSimples_v1.00.xsd): pattern
    // "0|[0-9]{1}(\.[0-9]{2})?" — 1 dígito inteiro + EXATAMENTE 2 casas.
    // 4 casas ("5.0000") viola o schema.
    tribMun.ele(ns, 'pAliq').txt(formatarValor(v.aliquotaIss * 100, 2));
    // tpRetISSQN (layout nacional): 1=Não Retido, 2=Retido pelo Tomador
    tribMun.ele(ns, 'tpRetISSQN').txt(v.issRetido ? '2' : '1');
  }

  // totTrib é OBRIGATÓRIO dentro de <trib> conforme XSD
  // Filhos possíveis: vTotTrib, pTotTrib, indTotTrib, pTotTribSN
  const totTrib = trib.ele(ns, 'totTrib');

  if (isSimples) {
    // Simples Nacional: usar pTotTribSN (percentual aproximado de tributos)
    // Valor informativo — percentual da alíquota efetiva do DAS
    // TSDec2V2: máximo 2 inteiros + 2 decimais (ex: "5.00")
    totTrib.ele(ns, 'pTotTribSN').txt(formatarValor(v.aliquotaIss * 100, 2));
  } else {
    // Regime Normal: totTrib é um CHOICE no XSD — vTotTrib (complexo, com
    // vTotTribFed/Est/Mun) OU pTotTrib OU indTotTrib. Emitir vTotTrib como
    // texto simples + indTotTrib juntos violava o schema (e o valor usado
    // era o ISS, semanticamente errado: vTotTrib é o total APROXIMADO de
    // tributos da Lei 12.741, não o ISS). Como não calculamos IBPT,
    // indTotTrib=0 ("não informado") é a opção válida e honesta.
    totTrib.ele(ns, 'indTotTrib').txt('0');
  }

  // ── 15: Informações complementares ──
  if (request.informacoesComplementares) {
    inf.ele(ns, 'infCompl').txt(request.informacoesComplementares);
  }

  return doc.end({ prettyPrint: false });
}

// ============================================================
// XML Builder: Evento de Cancelamento (e101101)
//
// Contrato SEFIN Nacional (pedRegEvento v1.00, tiposEventos_v1.00.xsd):
//
// <pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">
//   <infPedReg Id="PRE{chave50}{101101}">   ← TSIdPedRefEvt: PRE[0-9]{56}
//     1. tpAmb
//     2. verAplic
//     3. dhEvento                            ← TSDateTimeUTC
//     4. CNPJAutor | CPFAutor
//     5. chNFSe                              ← TSChaveNFSe: [0-9]{50}
//     6. e101101
//        └─ xDesc   (fixo "Cancelamento de NFS-e")
//        └─ cMotivo (TSCodJustCanc: 1=Erro emissão, 2=Serviço não prestado, 9=Outros)
//        └─ xMotivo (TSMotivo: 15–255 chars)
//   </infPedReg>
//   <Signature/>                             ← assinatura do infPedReg
// </pedRegEvento>
//
// Esteira: assinar infPedReg → GZip → Base64 →
// POST {sefin}/nfse/{chave}/eventos  { "pedidoRegistroEventoXmlGZipB64": "..." }
// ============================================================

const EVENTO_CANCELAMENTO = '101101';

/**
 * Mapeia o código de cancelamento do contrato público (1–4, legado ABRASF)
 * para o TSCodJustCanc do Padrão Nacional (1|2|9) e garante xMotivo válido
 * (TSMotivo: mínimo 15, máximo 255 caracteres).
 */
export function montarMotivoCancelamento(
  codigoCancelamento: string,
  motivo?: string,
): { cMotivo: '1' | '2' | '9'; xMotivo: string } {
  const cMotivo: '1' | '2' | '9' =
    codigoCancelamento === '1' ? '1'
    : codigoCancelamento === '2' ? '2'
    : '9'; // 3=Duplicidade, 4=Erro de processamento → "Outros" no Padrão Nacional

  const fallback: Record<'1' | '2' | '9', string> = {
    '1': 'Cancelamento por erro na emissao da NFS-e',
    '2': 'Cancelamento por servico nao prestado',
    '9': 'Cancelamento por outros motivos',
  };

  const informado = (motivo || '').trim();
  const xMotivo = informado.length >= 15 ? informado.slice(0, 255) : fallback[cMotivo];
  return { cMotivo, xMotivo };
}

export function buildEventoCancelamentoXml(params: {
  chaveAcesso: string;
  /** CNPJ (14 díg) ou CPF (11 díg) do autor do evento */
  documentoAutor: string;
  cMotivo: '1' | '2' | '9';
  xMotivo: string;
  ambiente: 'producao' | 'homologacao';
}): string {
  const chave = apenasNumeros(params.chaveAcesso);
  if (chave.length !== 50) {
    throw new Error(`Chave de acesso da NFS-e deve ter 50 dígitos (recebido: ${chave.length})`);
  }

  const docAutor = apenasNumeros(params.documentoAutor);
  if (docAutor.length !== 14 && docAutor.length !== 11) {
    throw new Error('Documento do autor do evento deve ser CNPJ (14 díg) ou CPF (11 díg)');
  }

  // TSIdPedRefEvt: "PRE" + chave(50) + tpEvento(6) = 59 chars (PRE[0-9]{56})
  const idPedReg = `PRE${chave}${EVENTO_CANCELAMENTO}`;

  // xmlbuilder2 escapa &, <, >, " e ' em .txt() — xMotivo livre de injection.
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const ped = doc.ele(DPS_NS, 'pedRegEvento').att('versao', '1.01');
  const inf = ped.ele(DPS_NS, 'infPedReg').att('Id', idPedReg);

  inf.ele(DPS_NS, 'tpAmb').txt(params.ambiente === 'producao' ? '1' : '2');
  inf.ele(DPS_NS, 'verAplic').txt('sefaz-api-1.01');
  inf.ele(DPS_NS, 'dhEvento').txt(formatarDataSefaz());
  inf.ele(DPS_NS, docAutor.length === 14 ? 'CNPJAutor' : 'CPFAutor').txt(docAutor);
  inf.ele(DPS_NS, 'chNFSe').txt(chave);

  const evento = inf.ele(DPS_NS, 'e101101');
  evento.ele(DPS_NS, 'xDesc').txt('Cancelamento de NFS-e');
  evento.ele(DPS_NS, 'cMotivo').txt(params.cMotivo);
  evento.ele(DPS_NS, 'xMotivo').txt(params.xMotivo);

  return doc.end({ prettyPrint: false });
}

// ============================================================
// Esteira: XML → Assinar → GZip → Base64
// ============================================================

export function gzipBase64(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, 'utf-8')).toString('base64');
}

function empacotarDps(xmlDps: string, certificado: CertificateData): string {
  const xmlAssinado = assinarXml(xmlDps, certificado, 'infDPS');
  return gzipBase64(xmlAssinado);
}

function empacotarEvento(xmlEvento: string, certificado: CertificateData): string {
  const xmlAssinado = assinarXml(xmlEvento, certificado, 'infPedReg');
  return gzipBase64(xmlAssinado);
}

/** Descompacta resposta da SEFIN ({nfse,evento}XmlGZipB64). null se inválido. */
function tryGunzipBase64(b64: unknown): string | null {
  if (typeof b64 !== 'string' || !b64) return null;
  try {
    return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf-8');
  } catch {
    return null;
  }
}

// ============================================================
// Parsers de resposta
// ============================================================

function extrairMensagens(data: any): NfseMensagemRetorno[] {
  const msgs: NfseMensagemRetorno[] = [];

  if (data?.erro) {
    msgs.push({
      codigo: String(data.erro.codigo || '0'),
      mensagem: String(data.erro.mensagem || data.erro.descricao || 'Erro desconhecido'),
      correcao: data.erro.correcao ? String(data.erro.correcao) : undefined,
    });
  }

  // A Sefin já respondeu "erros"/"Erros" com "codigo"/"Codigo" e "descricao"/"Descricao".
  const erros = data?.erros || data?.Erros;
  if (erros && Array.isArray(erros)) {
    for (const e of erros) {
      msgs.push({
        codigo: String(e.codigo || e.Codigo || '0'),
        mensagem: String(e.mensagem || e.descricao || e.Descricao || 'Erro'),
        correcao: e.correcao || e.complemento || e.Complemento
          ? String(e.correcao || e.complemento || e.Complemento)
          : undefined,
      });
    }
  }

  // RFC 7807 Problem Details
  if (data?.detail) {
    msgs.push({
      codigo: String(data.status || '0'),
      mensagem: String(data.detail),
      correcao: data.title ? String(data.title) : undefined,
    });
  }

  if (msgs.length === 0 && data?.message) {
    msgs.push({ codigo: '0', mensagem: String(data.message) });
  }

  if (msgs.length === 0 && data?.rawBody) {
    msgs.push({ codigo: '0', mensagem: String(data.rawBody).slice(0, 500) });
  }

  return msgs;
}

/** Número, código de verificação e emissão lidos do XML da NFS-e. */
function camposDoXml(xml: string | null): Pick<NfseResponse, 'numeroNfse' | 'codigoVerificacao' | 'dataEmissao'> {
  const n = xml?.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1];
  return {
    numeroNfse: n ? Number(n) : undefined,
    codigoVerificacao: xml?.match(/<cNFSe>([^<]+)<\/cNFSe>/)?.[1],
    dataEmissao: xml?.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1],
  };
}

/**
 * A resposta do POST /nfse da SEFIN Nacional: `{ idDps, chaveAcesso, nfseXmlGZipB64, alertas }`.
 * O formato antigo (`nfse.infNFSe` em JSON) ainda é lido, por compatibilidade. Antes só o antigo
 * era lido — com a resposta de verdade saíam sem número, sem XML e sem a chave (que o
 * cancelamento exige).
 */
export function parseEmitirResponse(status: number, data: any): NfseResponse {
  if (status >= 200 && status < 300) {
    const xml = tryGunzipBase64(data?.nfseXmlGZipB64);
    if (xml || data?.chaveAcesso) {
      return {
        success: true,
        status: 'autorizado',
        ...camposDoXml(xml),
        chaveAcesso: data?.chaveAcesso ? String(data.chaveAcesso) : xml?.match(/Id="NFS(\d{50})"/)?.[1],
        xml: xml || undefined,
        protocolo: data?.idDps ? String(data.idDps) : undefined,
      };
    }
    return {
      success: true,
      status: 'autorizado',
      numeroNfse: data?.nfse?.infNFSe?.nNFSe ? Number(data.nfse.infNFSe.nNFSe) : undefined,
      codigoVerificacao: data?.nfse?.infNFSe?.cNFSe ? String(data.nfse.infNFSe.cNFSe) : undefined,
      dataEmissao: data?.nfse?.infNFSe?.dhEmi ? String(data.nfse.infNFSe.dhEmi) : undefined,
      xml: data?.nfse ? JSON.stringify(data.nfse) : undefined,
      protocolo: data?.idDPS ? String(data.idDPS) : undefined,
    };
  }

  if (status === 422 || status === 400) {
    return {
      success: false,
      status: 'rejeitado',
      mensagens: extrairMensagens(data),
    };
  }

  return {
    success: false,
    status: 'erro',
    mensagens: extrairMensagens(data).length > 0
      ? extrairMensagens(data)
      : [{ codigo: String(status), mensagem: `SEFIN retornou status ${status}` }],
  };
}

// ============================================================
// Validação
// ============================================================

function validarDps(request: NfseEmitirRequest): string[] {
  const erros: string[] = [];

  if (!request.prestador?.cnpj) erros.push('CNPJ do prestador é obrigatório');
  if (!request.prestador?.inscricaoMunicipal) erros.push('Inscrição Municipal do prestador é obrigatória');
  if (!request.tomador?.nome) erros.push('Nome do tomador é obrigatório');
  if (!request.servico?.codigoServico) erros.push('Código do serviço (LC 116) é obrigatório');
  if (!request.servico?.discriminacao) erros.push('Discriminação do serviço é obrigatória');
  if (!request.servico?.codigoMunicipioPrestacao) erros.push('Código do município de prestação é obrigatório');
  if (!request.valores?.valorServicos || request.valores.valorServicos <= 0) {
    erros.push('Valor dos serviços deve ser maior que zero');
  }
  if (request.valores?.aliquotaIss === undefined || request.valores.aliquotaIss < 0) {
    erros.push('Alíquota ISS é obrigatória');
  } else if (request.valores.aliquotaIss > 1) {
    // 5 em vez de 0.05 = percentual passado por engano → pAliq sairia 500.00
    erros.push(
      `aliquotaIss deve ser decimal (0.05 = 5%) — valor ${request.valores.aliquotaIss} > 1 indica percentual informado por engano`,
    );
  }
  if (!request.rps?.numero) erros.push('Número do DPS é obrigatório');
  if (!request.rps?.serie) erros.push('Série do DPS é obrigatória');
  if (!request.rps?.dataEmissao) erros.push('Data de competência é obrigatória');
  if (!request.certificado?.pfxBase64 || !request.certificado?.password) {
    erros.push('Certificado digital A1 (pfxBase64 + password) é obrigatório');
  }

  return erros;
}

// ============================================================
// Provider
// ============================================================

export class NacionalProvider implements INfseProvider {
  readonly nome = 'Nacional (ADN)';

  async emitir(request: NfseEmitirRequest): Promise<NfseResponse> {
    try {
      const erros = validarDps(request);
      if (erros.length > 0) {
        return { success: false, status: 'erro', mensagens: erros.map(e => ({ codigo: '0', mensagem: e })) };
      }

      if (request.servico && !request.servico.codigoTributacaoNacional && request.servico.codigoServico) {
        request.servico.codigoTributacaoNacional = request.servico.codigoServico.replace(/\D/g, '').padEnd(6, '0');
      }

      // Mesmo ambiente do tpAmb do DPS (buildDpsXml usa request.ambiente) —
      // divergir aqui mandaria DPS de homologação pro endpoint de produção.
      const ambienteEfetivo = request.ambiente || config.sefazAmbiente;
      const endpoints = getAdnEndpoints(ambienteEfetivo);
      const enviar = async (leiaute: LeiauteDps) => {
        const xmlDps = buildDpsXmlNacional(request, leiaute);
        const dpsXmlGZipB64 = empacotarDps(xmlDps, request.certificado);
        const { status, data } = await httpRequest('POST', endpoints.emitir, request.certificado, { dpsXmlGZipB64 });
        return parseEmitirResponse(status, data);
      };
      const leiaute = leiauteDps(request);
      const resposta = await enviar(leiaute);
      // Recusa pelo esquema (E1235): a Sefin está no outro leiaute 1.01 (virada da NT 009).
      const peloEsquema = resposta.status === 'rejeitado'
        && (resposta.mensagens || []).some((m) => m.codigo === 'E1235' || m.codigo === 'RNG6110');
      if (peloEsquema) {
        console.warn(`[ADN] DPS recusada pelo esquema no leiaute ${leiaute}; tentando o outro`);
        return enviar(leiaute === 'vigente' ? 'nt009' : 'vigente');
      }
      return resposta;
    } catch (error: any) {
      console.error('[ADN] Falha interna ao emitir:', error.message);
      return {
        success: false,
        status: 'erro',
        mensagens: [{
          codigo: '0',
          mensagem: error.message || 'Falha desconhecida no provedor Nacional',
        }],
      };
    }
  }

  async cancelar(request: NfseCancelarRequest): Promise<NfseResponse> {
    try {
      const chave = apenasNumeros(request.chaveNFSe || '');
      if (chave.length !== 50) {
        return {
          success: false,
          status: 'erro',
          mensagens: [{
            codigo: '0',
            mensagem: 'chaveNFSe (chave de acesso de 50 dígitos) é obrigatória para cancelar no Padrão Nacional — o cancelamento é um evento e101101 registrado em POST /nfse/{chave}/eventos',
          }],
        };
      }
      if (!request.certificado?.pfxBase64 || !request.certificado?.password) {
        return {
          success: false,
          status: 'erro',
          mensagens: [{ codigo: '0', mensagem: 'Certificado digital A1 (pfxBase64 + password) é obrigatório' }],
        };
      }

      const ambienteEfetivo = request.ambiente || config.sefazAmbiente;
      const endpoints = getAdnEndpoints(ambienteEfetivo);

      const { cMotivo, xMotivo } = montarMotivoCancelamento(request.codigoCancelamento, request.motivo);

      const xmlEvento = buildEventoCancelamentoXml({
        chaveAcesso: chave,
        documentoAutor: request.prestador.cnpj,
        cMotivo,
        xMotivo,
        ambiente: ambienteEfetivo,
      });

      const pedidoRegistroEventoXmlGZipB64 = empacotarEvento(xmlEvento, request.certificado);

      const { status, data } = await httpRequest(
        'POST',
        `${endpoints.eventos}/${chave}/eventos`,
        request.certificado,
        { pedidoRegistroEventoXmlGZipB64 },
      );

      if (status >= 200 && status < 300) {
        const eventoXml = tryGunzipBase64(data?.eventoXmlGZipB64);
        // A resposta SEFIN de eventos não traz 'nProtocolo' — o identificador
        // do evento registrado vem no XML do evento (eventoXmlGZipB64). Tenta
        // nProt → Id do evento. (Tags exatas a confirmar em produção restrita.)
        const protocolo =
          eventoXml?.match(/<nProt>([^<]+)<\/nProt>/)?.[1]
          ?? eventoXml?.match(/<infEvento[^>]*\bId="([^"]+)"/)?.[1]
          ?? eventoXml?.match(/<idEvento>([^<]+)<\/idEvento>/)?.[1]
          ?? undefined;
        return {
          success: true,
          status: 'cancelado',
          protocolo,
          dataEmissao: data?.dataHoraProcessamento
            ? String(data.dataHoraProcessamento)
            : (eventoXml?.match(/<dhProc>([^<]+)<\/dhProc>/)?.[1]),
          xml: eventoXml || undefined,
        };
      }

      if (status === 404) {
        return {
          success: false,
          status: 'rejeitado',
          mensagens: [{
            codigo: '404',
            mensagem: `NFS-e não encontrada na SEFIN Nacional para a chave ${chave} — verifique a chave de acesso e o ambiente (${ambienteEfetivo})`,
          }],
        };
      }

      return {
        success: false,
        status: status === 400 || status === 422 ? 'rejeitado' : 'erro',
        mensagens: extrairMensagens(data).length > 0
          ? extrairMensagens(data)
          : [{ codigo: String(status), mensagem: `SEFIN retornou status ${status} ao registrar evento de cancelamento` }],
      };
    } catch (error: any) {
      return { success: false, status: 'erro', mensagens: [{ codigo: '0', mensagem: error.message || 'Erro no cancelamento via SEFIN' }] };
    }
  }

  // ──────────────────────────────────────────────────────────
  // Consulta — contrato SEFIN Nacional:
  //   GET /nfse/{chaveAcesso}  → NFS-e completa (nfseXmlGZipB64)
  //   GET /dps/{idDps}         → chave de acesso da NFS-e gerada pelo DPS
  //                              (recuperação pós-timeout: deriva o Id do
  //                              DPS dos mesmos dados usados na emissão)
  // ──────────────────────────────────────────────────────────
  async consultar(request: NfseConsultarNfseRequest): Promise<NfseResponse> {
    try {
      const ambienteEfetivo = request.ambiente || config.sefazAmbiente;
      const endpoints = getAdnEndpoints(ambienteEfetivo);

      const chave = apenasNumeros(request.chaveAcesso || '');
      const idDpsDireto = String(request.idDps || '').trim();

      let url: string;
      let alvo: string;
      if (idDpsDireto) {
        if (!/^DPS\d{42}$/.test(idDpsDireto)) {
          return {
            success: false,
            status: 'erro',
            mensagens: [{ codigo: '0', mensagem: `idDps inválido — formato esperado "DPS" + 42 dígitos (recebido: ${idDpsDireto.length} chars)` }],
          };
        }
        url = `${endpoints.consultarDps}/${idDpsDireto}`;
        alvo = `DPS ${idDpsDireto}`;
      } else if (chave.length === 50) {
        url = `${endpoints.consultar}/${chave}`;
        alvo = `chave ${chave}`;
      } else if (chave.length > 0) {
        return {
          success: false,
          status: 'erro',
          mensagens: [{ codigo: '0', mensagem: `chaveAcesso deve ter 50 dígitos (recebido: ${chave.length})` }],
        };
      } else {
        if (!request.numero || !request.codigoMunicipio || !request.prestador?.cnpj) {
          return {
            success: false,
            status: 'erro',
            mensagens: [{
              codigo: '0',
              mensagem: 'Consulta no Padrão Nacional exige chaveAcesso (50 dígitos) OU numero + serie + codigoMunicipio + prestador.cnpj para derivar o Id do DPS',
            }],
          };
        }
        const idDps = montarIdDps({
          codigoMunicipio: request.codigoMunicipio,
          cnpj: request.prestador.cnpj,
          serie: request.serie || '1',
          numero: request.numero,
        });
        url = `${endpoints.consultarDps}/${idDps}`;
        alvo = `DPS ${idDps}`;
      }

      const { status, data } = await httpRequest('GET', url, request.certificado);

      if (status >= 200 && status < 300) {
        // GET /dps/{id} → { chaveAcesso }; GET /nfse/{chave} → { nfseXmlGZipB64, ... }
        const chaveRetornada = data?.chaveAcesso ? String(data.chaveAcesso) : (chave || undefined);
        let nfseXml = tryGunzipBase64(data?.nfseXmlGZipB64);
        // Pelo DPS só vem a chave: busca a NFS-e por ela, para devolver o XML e o número (a
        // recuperação pós-timeout precisa deles tanto quanto da chave).
        if (!nfseXml && chaveRetornada && apenasNumeros(chaveRetornada).length === 50) {
          const segunda = await httpRequest(
            'GET',
            `${endpoints.consultar}/${apenasNumeros(chaveRetornada)}`,
            request.certificado,
          );
          if (segunda.status >= 200 && segunda.status < 300) {
            nfseXml = tryGunzipBase64(segunda.data?.nfseXmlGZipB64);
          }
        }

        return {
          success: true,
          status: 'autorizado',
          numeroNfse: nfseXml?.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1]
            ? Number(nfseXml.match(/<nNFSe>(\d+)<\/nNFSe>/)![1])
            : undefined,
          codigoVerificacao: nfseXml?.match(/<cNFSe>([^<]+)<\/cNFSe>/)?.[1],
          dataEmissao: nfseXml?.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1],
          protocolo: chaveRetornada,
          chaveAcesso: chaveRetornada,
          xml: nfseXml || undefined,
          mensagens: chaveRetornada && !nfseXml
            ? [{ codigo: '200', mensagem: `DPS processado — NFS-e gerada com chave de acesso ${chaveRetornada}` }]
            : undefined,
        };
      }

      // 404 não é falha de infra: significa "documento não existe" —
      // na recuperação pós-timeout indica que o DPS NÃO foi processado
      // e a emissão pode ser reenviada com segurança.
      if (status === 404) {
        return {
          success: false,
          status: 'rejeitado',
          mensagens: [{
            codigo: '404',
            mensagem: `NFS-e não encontrada na SEFIN Nacional (${alvo}, ambiente ${ambienteEfetivo}) — o documento não existe ou ainda não foi processado`,
          }],
        };
      }

      return {
        success: false,
        status: 'erro',
        mensagens: extrairMensagens(data).length > 0
          ? extrairMensagens(data)
          : [{ codigo: String(status), mensagem: `SEFIN retornou status ${status} na consulta (${alvo})` }],
      };
    } catch (error: any) {
      return { success: false, status: 'erro', mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na consulta via SEFIN Nacional' }] };
    }
  }
}
