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
  console.log(`[ADN] httpRequest ${method} ${url}`);

  let pfx: Buffer;
  try {
    pfx = pfxToBuffer(certificado.pfxBase64);
    console.log(`[ADN] Certificado PFX decodificado (${pfx.length} bytes)`);
  } catch (err: any) {
    console.error('[FATAL-ADN] Falha ao decodificar certificado PFX:', err);
    throw new Error(`Falha ao decodificar certificado PFX: ${err.message}`);
  }

  let agent: https.Agent;
  try {
    agent = new https.Agent({
      pfx,
      passphrase: certificado.password,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    });
    console.log('[ADN] Certificado carregado e Agent mTLS configurado com sucesso.');
  } catch (err: any) {
    console.error('[FATAL-ADN] Falha ao criar https.Agent com certificado:', err);
    throw new Error(`Falha ao criar Agent mTLS: ${err.message}`);
  }

  let payload: string | undefined;
  try {
    payload = body ? JSON.stringify(body) : undefined;
    if (payload) {
      console.log(`[ADN] Payload JSON montado (${payload.length} chars)`);
    }
  } catch (err: any) {
    console.error('[FATAL-ADN] Falha ao serializar payload JSON:', err);
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

export function buildDpsXml(request: NfseEmitirRequest, ns: string = DPS_NS): string {
  const cnpj = apenasNumeros(request.prestador.cnpj);
  const v = request.valores;
  const ambienteEfetivo = (request as any).ambiente || config.sefazAmbiente;
  const tpAmb = ambienteEfetivo === 'producao' ? '1' : '2';
  const isSimples = request.prestador.optanteSimplesNacional;

  const cTribNac = request.servico.codigoTributacaoNacional
    || request.servico.codigoServico.replace(/\D/g, '').padEnd(6, '0');

  // Série: ADN exige valor numérico. Legados alfanuméricos → "1"
  const serieNumerica = /^\d+$/.test(request.rps.serie) ? request.rps.serie : '1';

  // ── Id da infDPS ── TSIdDPS: "DPS"(3) + 42 dígitos = 45 chars
  // Composição: DPS + cLocEmi(7) + tpInsc(1) + CNPJ(14) + serie(5) + nDPS(15)
  const cLocEmiVal = request.servico.codigoMunicipioPrestacao.padStart(7, '0');
  const infDpsId = `DPS${cLocEmiVal}2${cnpj.padStart(14, '0')}${serieNumerica.padStart(5, '0')}${String(request.rps.numero).padStart(15, '0')}`;

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
    tribMun.ele(ns, 'tpRetISSQN').txt(v.issRetido ? '1' : '2');
  } else {
    // ═══ REGIME NORMAL → <tribMun> ═══
    // XSD tribMun: tribISSQN → cPaisResult? → pAliq → tpRetISSQN
    const tribMun = trib.ele(ns, 'tribMun');
    tribMun.ele(ns, 'tribISSQN').txt(tribISSQN);
    if (tribISSQN === '3' && request.servico.codigoPaisPrestacao) {
      tribMun.ele(ns, 'cPaisResult').txt(request.servico.codigoPaisPrestacao);
    }
    tribMun.ele(ns, 'pAliq').txt(formatarValor(v.aliquotaIss * 100, 4));
    tribMun.ele(ns, 'tpRetISSQN').txt(v.issRetido ? '1' : '2');
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
    // Regime Normal: usar indTotTrib (indicador de tributação total)
    // 0=Não informado, 1=Informado pelo contribuinte, 2=Calculado pelo sistema
    const baseCalculo = v.valorServicos - (v.valorDeducoes || 0) - (v.descontoIncondicionado || 0);
    const valorIss = baseCalculo * v.aliquotaIss;
    totTrib.ele(ns, 'vTotTrib').txt(formatarValor(valorIss));
    totTrib.ele(ns, 'indTotTrib').txt('0');
  }

  // ── 15: Informações complementares ──
  if (request.informacoesComplementares) {
    inf.ele(ns, 'infCompl').txt(request.informacoesComplementares);
  }

  return doc.end({ prettyPrint: false });
}

// ============================================================
// Esteira: XML → Assinar → GZip → Base64
// ============================================================

function empacotarDps(xmlDps: string, certificado: CertificateData): string {
  // Log do XML bruto ANTES de assinar/compactar
  console.log('[ADN] XML Bruto (antes da assinatura):');
  console.log(xmlDps);

  // 1. Assinar a tag <infDPS>
  console.log('[ADN] Assinando <infDPS>...');
  const xmlAssinado = assinarXml(xmlDps, certificado, 'infDPS');
  console.log('[ADN] XML Assinado:');
  console.log(xmlAssinado);

  // 2. Compactar com GZip
  console.log('[ADN] Compactando XML com GZip...');
  const gzipped = zlib.gzipSync(Buffer.from(xmlAssinado, 'utf-8'));
  console.log(`[ADN] GZip concluído (${gzipped.length} bytes)`);

  // 3. Converter para Base64
  const base64 = gzipped.toString('base64');
  console.log(`[ADN] Base64 gerado (${base64.length} chars)`);

  return base64;
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
      console.log('[ADN] Iniciando emissão NFS-e via Padrão Nacional...');

      // Validar
      const erros = validarDps(request);
      if (erros.length > 0) {
        console.log(`[ADN] Validação falhou: ${erros.join('; ')}`);
        return { success: false, status: 'erro', mensagens: erros.map(e => ({ codigo: '0', mensagem: e })) };
      }
      console.log('[ADN] Validação OK');

      // Auto-preenche cTribNac
      if (request.servico && !request.servico.codigoTributacaoNacional && request.servico.codigoServico) {
        request.servico.codigoTributacaoNacional = request.servico.codigoServico.replace(/\D/g, '').padEnd(6, '0');
        console.log(`[ADN] cTribNac auto-preenchido: ${request.servico.codigoTributacaoNacional}`);
      }

      // 1. Construir XML do DPS
      console.log('[ADN] Construindo XML do DPS...');
      const xmlDps = buildDpsXml(request);
      console.log(`[ADN] XML DPS construído (${xmlDps.length} chars)`);

      // 2. Assinar + GZip + Base64
      const dpsXmlGZipB64 = empacotarDps(xmlDps, request.certificado);

      // 3. POST { dpsXmlGZipB64 } via mTLS
      const endpoints = getAdnEndpoints(config.sefazAmbiente);
      console.log(`[ADN] Endpoint emissão: ${endpoints.emitir}`);

      const { status, data, raw } = await httpRequest(
        'POST',
        endpoints.emitir,
        request.certificado,
        { dpsXmlGZipB64 },
      );
      console.log(`[ADN] Resposta recebida: HTTP ${status}`);

      if (status >= 400) {
        console.error(`[ADN] Detalhes da rejeição do Governo (HTTP ${status}):`, JSON.stringify(data, null, 2));
        console.error(`[ADN] Body bruto:`, raw.slice(0, 2000));
      }

      return parseEmitirResponse(status, data);
    } catch (error: any) {
      console.error('[FATAL-ADN] Falha interna:', error);
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
      const ambienteEfetivo = request.ambiente || config.sefazAmbiente;
      const endpoints = getAdnEndpoints(ambienteEfetivo);

      // Cancelamento também usa XML → GZip → Base64
      // Mas por ora envia JSON direto (a ser ajustado quando testarmos)
      const payload = {
        chNFSe: request.numero ? String(request.numero) : undefined,
        codigoCancelamento: request.codigoCancelamento,
        CNPJ: apenasNumeros(request.prestador.cnpj),
        IM: request.prestador.inscricaoMunicipal,
        cMun: request.codigoMunicipio,
        tpAmb: ambienteEfetivo === 'producao' ? '1' : '2',
      };

      const { status, data } = await httpRequest('POST', endpoints.cancelar, request.certificado, payload);

      if (status >= 200 && status < 300) {
        return {
          success: true,
          status: 'cancelado',
          dataEmissao: data?.dhCanc ? String(data.dhCanc) : undefined,
        };
      }

      return {
        success: false,
        status: 'rejeitado',
        mensagens: extrairMensagens(data).length > 0
          ? extrairMensagens(data)
          : [{ codigo: String(status), mensagem: `SEFIN retornou status ${status} ao cancelar` }],
      };
    } catch (error: any) {
      return { success: false, status: 'erro', mensagens: [{ codigo: '0', mensagem: error.message || 'Erro no cancelamento via SEFIN' }] };
    }
  }

  async consultar(request: NfseConsultarNfseRequest): Promise<NfseResponse> {
    try {
      const endpoints = getAdnEndpoints(config.sefazAmbiente);

      const params = new URLSearchParams();
      params.set('CNPJ', apenasNumeros(request.prestador.cnpj));
      params.set('IM', request.prestador.inscricaoMunicipal);
      if (request.numero) params.set('nNFSe', String(request.numero));
      if (request.dataInicial) params.set('dhEmiIni', request.dataInicial);
      if (request.dataFinal) params.set('dhEmiFim', request.dataFinal);
      params.set('tpAmb', config.sefazAmbiente === 'producao' ? '1' : '2');

      const url = `${endpoints.consultar}?${params.toString()}`;
      const { status, data } = await httpRequest('GET', url, request.certificado);

      if (status >= 200 && status < 300) {
        const nfse = data?.nfse || (Array.isArray(data) ? data[0] : null);
        const infNFSe = nfse?.infNFSe;

        return {
          success: true,
          status: 'autorizado',
          numeroNfse: infNFSe?.nNFSe ? Number(infNFSe.nNFSe) : undefined,
          codigoVerificacao: infNFSe?.cNFSe ? String(infNFSe.cNFSe) : undefined,
          dataEmissao: infNFSe?.dhEmi ? String(infNFSe.dhEmi) : undefined,
        };
      }

      return {
        success: false,
        status: 'rejeitado',
        mensagens: extrairMensagens(data).length > 0
          ? extrairMensagens(data)
          : [{ codigo: String(status), mensagem: `ADN retornou status ${status} na consulta` }],
      };
    } catch (error: any) {
      return { success: false, status: 'erro', mensagens: [{ codigo: '0', mensagem: error.message || 'Erro na consulta via ADN' }] };
    }
  }
}
