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

export function buildDpsXml(request: NfseEmitirRequest, ns: string = DPS_NS): string {
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
  const ped = doc.ele(DPS_NS, 'pedRegEvento').att('versao', '1.00');
  const inf = ped.ele(DPS_NS, 'infPedReg').att('Id', idPedReg);

  inf.ele(DPS_NS, 'tpAmb').txt(params.ambiente === 'producao' ? '1' : '2');
  inf.ele(DPS_NS, 'verAplic').txt('sefaz-api-1.0');
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

  if (data?.erros && Array.isArray(data.erros)) {
    for (const e of data.erros) {
      msgs.push({
        codigo: String(e.codigo || '0'),
        mensagem: String(e.mensagem || e.descricao || 'Erro'),
        correcao: e.correcao ? String(e.correcao) : undefined,
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

function parseEmitirResponse(status: number, data: any): NfseResponse {
  if (status >= 200 && status < 300) {
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

      const xmlDps = buildDpsXml(request);
      const dpsXmlGZipB64 = empacotarDps(xmlDps, request.certificado);

      // Mesmo ambiente do tpAmb do DPS (buildDpsXml usa request.ambiente) —
      // divergir aqui mandaria DPS de homologação pro endpoint de produção.
      const ambienteEfetivo = request.ambiente || config.sefazAmbiente;
      const endpoints = getAdnEndpoints(ambienteEfetivo);

      const { status, data } = await httpRequest(
        'POST',
        endpoints.emitir,
        request.certificado,
        { dpsXmlGZipB64 },
      );

      return parseEmitirResponse(status, data);
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
        return {
          success: true,
          status: 'cancelado',
          protocolo: data?.nProtocolo ? String(data.nProtocolo) : undefined,
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
        const nfseXml = tryGunzipBase64(data?.nfseXmlGZipB64);

        return {
          success: true,
          status: 'autorizado',
          numeroNfse: nfseXml?.match(/<nNFSe>(\d+)<\/nNFSe>/)?.[1]
            ? Number(nfseXml.match(/<nNFSe>(\d+)<\/nNFSe>/)![1])
            : undefined,
          codigoVerificacao: nfseXml?.match(/<cNFSe>([^<]+)<\/cNFSe>/)?.[1],
          dataEmissao: nfseXml?.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1],
          protocolo: chaveRetornada,
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
