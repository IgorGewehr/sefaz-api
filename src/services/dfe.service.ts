// ============================================================
// DF-e para o destinatário — Distribuição (NFeDistribuicaoDFe) e Manifestação
// do Destinatário (eventos 2102xx), ambos no Ambiente Nacional.
//
// Sem estado, como o resto da API: quem guarda o NSU é o cliente. Regras que o
// cliente precisa seguir (a SEFAZ barra quem não segue — cStat 656, "consumo
// indevido", e uma hora de espera):
// - pedir a partir do último `ultNSU` devolvido, nunca voltar atrás;
// - parar quando `ultNSU` alcança `maxNSU` e só voltar depois de 1 hora;
// - 656 = esperar 1 hora.
// O resumo (resNFe) vira nota completa (procNFe) depois da Ciência da Operação
// (210210): a nota chega por um NSU novo, ou pela consulta por chave.
//
// Referência de campo: gestao-raiz `src/lib/fiscal/sefaz-distribuicao.ts`
// (em produção) e o MOC/NT 2014.002.
// ============================================================

import * as zlib from 'zlib';
import { enviarSoap } from '../lib/sefaz/soap-client';
import { assinarEvento } from '../lib/sefaz/xml-signer';
import { UF_CODES, apenasNumeros, escapeXml, formatarDataSefaz } from '../lib/utils';
import { config } from '../config';
import { montarProcEventoNFe, parseRetEvento } from './nfe.service';
import type { CertificateData, SefazResponse } from '../types';

const SEFAZ_NS = 'http://www.portalfiscal.inf.br/nfe';
const DIST_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe';
const DIST_ACTION = `${DIST_NS}/nfeDistDFeInteresse`;
const EVENTO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
// No Ambiente Nacional a operação é nfeRecepcaoEventoNF (nas UFs, nfeRecepcaoEvento).
const EVENTO_AN_ACTION = `${EVENTO_NS}/nfeRecepcaoEventoNF`;

const URLS = {
  distribuicao: {
    producao: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
  },
  evento: {
    producao: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    homologacao: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  },
} as const;

type Ambiente = 'producao' | 'homologacao';

/** O que veio num docZip. */
export type TipoDocumentoDfe = 'resNFe' | 'procNFe' | 'resEvento' | 'procEventoNFe' | 'outro';

export interface DocumentoDfe {
  nsu: string;
  /** O schema declarado pela SEFAZ (ex.: resNFe_v1.01.xsd). */
  schema: string;
  tipo: TipoDocumentoDfe;
  /** A chave da NF-e a que o documento se refere ('' se não achou). */
  chaveAcesso: string;
  /** O XML descompactado. */
  xml: string;
}

export interface DfeResponse {
  success: boolean;
  /** 'ok' (137/138), 'consumo_indevido' (656: esperar 1h), 'rejeitado' ou 'erro'. */
  status: 'ok' | 'consumo_indevido' | 'rejeitado' | 'erro';
  codigoStatus: string;
  motivoStatus: string;
  /** O último NSU pesquisado — o próximo pedido parte dele. Vazio quando a resposta não o trouxe. */
  ultNSU: string;
  /** O maior NSU que existe para o CNPJ. */
  maxNSU: string;
  /** Data/hora da resposta da SEFAZ. */
  dataResposta?: string;
  documentos: DocumentoDfe[];
  erros?: string[];
}

export interface DfeDistribuicaoRequest {
  cnpj: string;
  /** UF do interessado: sigla ("RS") ou código IBGE ("43"). */
  ufAutor: string;
  /** Último NSU já lido (0 = desde o início). */
  ultNSU?: string | number;
  certificado: CertificateData;
  ambiente?: Ambiente;
}

export interface DfeConsultaChaveRequest {
  cnpj: string;
  ufAutor: string;
  chaveAcesso: string;
  certificado: CertificateData;
  ambiente?: Ambiente;
}

export type TipoManifestacao = 'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada';

export interface ManifestacaoRequest {
  cnpj: string;
  chaveAcesso: string;
  tipo: TipoManifestacao;
  /** Obrigatória (15 a 255) na operação não realizada. */
  justificativa?: string;
  certificado: CertificateData;
  ambiente?: Ambiente;
}

/** Os eventos da Manifestação do Destinatário. */
export const MANIFESTACOES: Record<TipoManifestacao, { tpEvento: string; descEvento: string }> = {
  confirmacao: { tpEvento: '210200', descEvento: 'Confirmacao da Operacao' },
  ciencia: { tpEvento: '210210', descEvento: 'Ciencia da Operacao' },
  desconhecimento: { tpEvento: '210220', descEvento: 'Desconhecimento da Operacao' },
  nao_realizada: { tpEvento: '210240', descEvento: 'Operacao nao Realizada' },
};

/** NSU com 15 dígitos (o leiaute pede). Exportada para testes. */
export function nsu15(nsu: string | number | undefined): string {
  const digitos = String(nsu ?? '0').replace(/\D/g, '') || '0';
  if (digitos.length > 15) throw new Error(`NSU inválido: "${nsu}"`);
  return digitos.padStart(15, '0');
}

/** Código IBGE da UF a partir da sigla ou do próprio código. Exportada para testes. */
export function codigoUf(uf: string): string {
  const u = String(uf ?? '').trim().toUpperCase();
  if (/^\d{2}$/.test(u) && Object.values(UF_CODES).includes(u)) return u;
  const c = UF_CODES[u];
  if (!c) throw new Error(`UF inválida: "${uf}"`);
  return c;
}

function valor(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1]?.trim() ?? '';
}

function tipoDoSchema(schema: string): TipoDocumentoDfe {
  const s = schema.toLowerCase();
  if (s.startsWith('resnfe')) return 'resNFe';
  if (s.startsWith('procnfe')) return 'procNFe';
  if (s.startsWith('resevento')) return 'resEvento';
  if (s.startsWith('proceventonfe')) return 'procEventoNFe';
  return 'outro';
}

function chaveDoDocumento(xml: string): string {
  const ch = valor(xml, 'chNFe');
  if (/^\d{44}$/.test(ch)) return ch;
  return xml.match(/Id="NFe(\d{44})"/)?.[1] ?? '';
}

/**
 * Interpreta a resposta do NFeDistribuicaoDFe. Pura — exportada para testes.
 *
 * Resposta sem cStat (HTML de erro, certificado recusado) é `erro`, e o
 * `ultNSU` volta vazio: o cliente não pode avançar (nem zerar) o NSU com ela.
 */
export function interpretarDistribuicao(soapXml: string, exigeNsu = true): DfeResponse {
  const ret = soapXml.match(/<retDistDFeInt[\s>][\s\S]*<\/retDistDFeInt>/)?.[0] ?? '';
  const cStat = valor(ret, 'cStat');
  const xMotivo = valor(ret, 'xMotivo');
  const ultNSU = valor(ret, 'ultNSU');
  const maxNSU = valor(ret, 'maxNSU');
  const base = {
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    ultNSU: ultNSU ? nsu15(ultNSU) : '',
    maxNSU: maxNSU ? nsu15(maxNSU) : '',
    dataResposta: valor(ret, 'dhResp') || undefined,
    documentos: [] as DocumentoDfe[],
  };
  if (!cStat) {
    return {
      ...base,
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: 'Resposta da SEFAZ sem retDistDFeInt/cStat — NSU não deve avançar',
      ultNSU: '',
      maxNSU: '',
    };
  }
  if (cStat === '656') {
    return { ...base, success: false, status: 'consumo_indevido' };
  }
  if (cStat !== '137' && cStat !== '138') {
    return { ...base, success: false, status: 'rejeitado', erros: [xMotivo] };
  }
  if (exigeNsu && !ultNSU) {
    return {
      ...base,
      success: false,
      status: 'erro',
      motivoStatus: `Resposta ${cStat} sem ultNSU — NSU não deve avançar`,
    };
  }
  const documentos: DocumentoDfe[] = [];
  const erros: string[] = [];
  for (const m of ret.matchAll(/<docZip([^>]*)>([^<]*)<\/docZip>/g)) {
    const atributos = m[1];
    const nsu = atributos.match(/NSU="(\d+)"/)?.[1] ?? '';
    const schema = atributos.match(/schema="([^"]+)"/)?.[1] ?? '';
    try {
      const xml = zlib.gunzipSync(Buffer.from(m[2].trim(), 'base64')).toString('utf8');
      documentos.push({ nsu: nsu15(nsu), schema, tipo: tipoDoSchema(schema), chaveAcesso: chaveDoDocumento(xml), xml });
    } catch (e: any) {
      erros.push(`NSU ${nsu}: docZip ilegível (${e.message})`);
    }
  }
  return { ...base, success: true, status: 'ok', documentos, ...(erros.length ? { erros } : {}) };
}

function corpoDistribuicao(interno: string): string {
  return (
    `<nfeDistDFeInteresse xmlns="${DIST_NS}">` +
    `<nfeDadosMsg>${interno}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>`
  );
}

function distDFeInt(cnpj: string, cUFAutor: string, ambiente: Ambiente, pedido: string): string {
  return (
    `<distDFeInt xmlns="${SEFAZ_NS}" versao="1.01">` +
    `<tpAmb>${ambiente === 'producao' ? '1' : '2'}</tpAmb>` +
    `<cUFAutor>${cUFAutor}</cUFAutor>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    pedido +
    `</distDFeInt>`
  );
}

function falha(e: any): DfeResponse {
  return {
    success: false,
    status: 'erro',
    codigoStatus: 'ERR',
    motivoStatus: e?.message || 'Erro na distribuição DF-e',
    ultNSU: '',
    maxNSU: '',
    documentos: [],
    erros: [e?.message || String(e)],
  };
}

/** Uma página da distribuição a partir de `ultNSU` (até 50 documentos). */
export async function consultarDistribuicao(req: DfeDistribuicaoRequest): Promise<DfeResponse> {
  try {
    const ambiente = req.ambiente || config.sefazAmbiente;
    const pedido = `<distNSU><ultNSU>${nsu15(req.ultNSU)}</ultNSU></distNSU>`;
    const corpo = corpoDistribuicao(distDFeInt(apenasNumeros(req.cnpj), codigoUf(req.ufAutor), ambiente, pedido));
    const resposta = await enviarSoap(URLS.distribuicao[ambiente], DIST_ACTION, corpo, req.certificado);
    return interpretarDistribuicao(resposta);
  } catch (e: any) {
    return falha(e);
  }
}

/** Os documentos de uma chave (a nota completa, se já há Ciência; senão o resumo). */
export async function consultarPorChave(req: DfeConsultaChaveRequest): Promise<DfeResponse> {
  try {
    const ambiente = req.ambiente || config.sefazAmbiente;
    const pedido = `<consChNFe><chNFe>${req.chaveAcesso}</chNFe></consChNFe>`;
    const corpo = corpoDistribuicao(distDFeInt(apenasNumeros(req.cnpj), codigoUf(req.ufAutor), ambiente, pedido));
    const resposta = await enviarSoap(URLS.distribuicao[ambiente], DIST_ACTION, corpo, req.certificado);
    return interpretarDistribuicao(resposta, false);
  } catch (e: any) {
    return falha(e);
  }
}

/**
 * Manifestação do Destinatário (evento no Ambiente Nacional, cOrgao 91). Aceita
 * volta com o procEventoNFe em `xml`; 573 (já manifestado) volta como falha,
 * com o código, para o cliente tratar como feito.
 */
export async function manifestar(req: ManifestacaoRequest): Promise<SefazResponse> {
  try {
    const ambiente = req.ambiente || config.sefazAmbiente;
    const tpAmb = ambiente === 'producao' ? '1' : '2';
    const m = MANIFESTACOES[req.tipo];
    if (!m) throw new Error(`Tipo de manifestação inválido: "${req.tipo}"`);
    const chave = req.chaveAcesso;
    const idEvento = `ID${m.tpEvento}${chave}01`;
    const justificativa =
      req.tipo === 'nao_realizada' ? `<xJust>${escapeXml(req.justificativa ?? '')}</xJust>` : '';
    const envEvento =
      `<envEvento xmlns="${SEFAZ_NS}" versao="1.00">` +
      `<idLote>${Date.now()}</idLote>` +
      // O namespace explícito no evento: o Ambiente Nacional valida o bloco sozinho.
      `<evento xmlns="${SEFAZ_NS}" versao="1.00">` +
      `<infEvento Id="${idEvento}">` +
      `<cOrgao>91</cOrgao>` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<CNPJ>${apenasNumeros(req.cnpj)}</CNPJ>` +
      `<chNFe>${chave}</chNFe>` +
      `<dhEvento>${formatarDataSefaz()}</dhEvento>` +
      `<tpEvento>${m.tpEvento}</tpEvento>` +
      `<nSeqEvento>1</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00">` +
      `<descEvento>${m.descEvento}</descEvento>` +
      justificativa +
      `</detEvento>` +
      `</infEvento>` +
      `</evento>` +
      `</envEvento>`;
    const assinado = assinarEvento(envEvento, req.certificado);
    const corpo = `<nfeDadosMsg xmlns="${EVENTO_NS}">${assinado.replace(/<\?xml[^>]*\?>\s*/, '')}</nfeDadosMsg>`;
    const resposta = await enviarSoap(URLS.evento[ambiente], EVENTO_AN_ACTION, corpo, req.certificado);
    const ret = resposta.match(/<retEnvEvento[\s>][\s\S]*<\/retEnvEvento>/)?.[0] ?? '';
    const retEvento = ret.match(/<retEvento[\s>][\s\S]*?<\/retEvento>/)?.[0] ?? '';
    const retorno = {
      retEnvEvento: {
        cStat: valor(ret.replace(retEvento, ''), 'cStat'),
        xMotivo: valor(ret.replace(retEvento, ''), 'xMotivo'),
        ...(retEvento
          ? {
              retEvento: {
                infEvento: {
                  cStat: valor(retEvento, 'cStat'),
                  xMotivo: valor(retEvento, 'xMotivo'),
                  nProt: valor(retEvento, 'nProt'),
                  dhRegEvento: valor(retEvento, 'dhRegEvento'),
                },
              },
            }
          : {}),
      },
    };
    const resultado = parseRetEvento(retorno, chave);
    if (resultado.success) {
      resultado.xml = montarProcEventoNFe(assinado, resposta);
    }
    return resultado;
  } catch (e: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: e?.message || 'Erro na manifestação do destinatário',
      erros: [e?.message || String(e)],
    };
  }
}
