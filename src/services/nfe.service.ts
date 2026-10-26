// ============================================================
// NFe/NFCe Service - Orquestração de emissão fiscal
// ============================================================

import { buildNFeXml, buildNFCeXml, buildNFCeSupl, buildNFCeSuplContingencia } from '../lib/nfe/xml-builder';
import { naoChegouASefaz } from '../lib/sefaz/soap-client';
import { assinarXml, assinarEvento, assinarInutilizacao } from '../lib/sefaz/xml-signer';
import { enviarSoap, extrairRetorno } from '../lib/sefaz/soap-client';
import { getNFeEndpoints, getNFCeEndpoints } from '../lib/sefaz/endpoints';
import {
  UF_CODES,
  gerarCodigoNumerico,
  montarChaveAcesso,
  gerarIdLote,
  formatarDataSefaz,
  formatarValor,
  apenasNumeros,
  escapeXml,
} from '../lib/utils';
import { config, getTpAmb } from '../config';
import type {
  NFeRequest,
  NFCeRequest,
  NFeConsultaRequest,
  NFeCancelarRequest,
  NFeCartaCorrecaoRequest,
  NFeInutilizarRequest,
  StatusServicoRequest,
  SefazResponse,
  CertificateData,
  TpAmb,
} from '../types';

// ============================================================
// Constantes
// ============================================================

const SEFAZ_NS = 'http://www.portalfiscal.inf.br/nfe';
const AUTORIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4';
const RET_AUTORIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4';
const CONSULTA_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4';
const STATUS_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4';
const RECEPCAO_EVENTO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const INUTILIZACAO_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4';

const MAX_POLLING_ATTEMPTS = 10;
const POLLING_INTERVAL_MS = 3000;

// ============================================================
// Helpers
// ============================================================

/**
 * Pausa execução por ms milissegundos
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Valida se valor = BC × alíquota / 100
 */
function validateTaxCalculation(
  bc: number | undefined,
  aliquota: number | undefined,
  valor: number | undefined,
  tolerance: number = 0.01
): boolean {
  if (bc === undefined || aliquota === undefined || valor === undefined) {
    return true; // Se não tem valores, não valida
  }

  const expectedValue = (bc * aliquota) / 100;
  const diff = Math.abs(expectedValue - valor);

  return diff <= tolerance;
}

/**
 * Valida payload de NF-e antes de gerar XML
 */
function validateNFePayload(req: NFeRequest): string[] {
  const errors: string[] = [];

  // Validar campos básicos
  if (!req.numero) errors.push('Número da NF-e é obrigatório');
  if (!req.ufEmitente || !/^[A-Z]{2}$/.test(req.ufEmitente)) {
    errors.push('UF do emitente inválida');
  }

  // Validar emitente
  if (!req.emitente) {
    errors.push('Dados do emitente são obrigatórios');
  } else {
    if (!req.emitente.cnpj) errors.push('CNPJ do emitente é obrigatório');
    if (!req.emitente.inscricaoEstadual) errors.push('IE do emitente é obrigatória');
    if (!req.emitente.crt || !['1','2','3'].includes(req.emitente.crt)) {
      errors.push('CRT do emitente inválido (1, 2 ou 3)');
    }
  }

  // Validar destinatário
  if (!req.destinatario) {
    errors.push('Dados do destinatário são obrigatórios');
  } else {
    if (!req.destinatario.cnpj && !req.destinatario.cpf && !req.destinatario.idEstrangeiro) {
      errors.push('Destinatário deve ter CNPJ, CPF ou ID estrangeiro');
    }
  }

  // Validar itens
  if (!req.itens || req.itens.length === 0) {
    errors.push('NF-e deve ter ao menos 1 item');
  } else {
    req.itens.forEach((item, i) => {
      const idx = i + 1;

      // Produto
      if (!item.produto) {
        errors.push(`Item ${idx}: dados do produto são obrigatórios`);
        return;
      }

      const p = item.produto;

      // NCM
      if (!p.ncm || !/^\d{8}$/.test(p.ncm)) {
        errors.push(`Item ${idx}: NCM inválido (deve ter 8 dígitos)`);
      }

      // CFOP
      if (!p.cfop || !/^\d{4}$/.test(p.cfop)) {
        errors.push(`Item ${idx}: CFOP inválido (deve ter 4 dígitos)`);
      }

      // CEST (se presente)
      if (p.cest && !/^\d{7}$/.test(p.cest)) {
        errors.push(`Item ${idx}: CEST inválido (deve ter 7 dígitos)`);
      }

      // Descrição
      if (!p.descricao || p.descricao.trim().length === 0) {
        errors.push(`Item ${idx}: descrição do produto é obrigatória`);
      }

      // Valores
      if (!p.quantidade || p.quantidade <= 0) {
        errors.push(`Item ${idx}: quantidade deve ser maior que zero`);
      }
      if (!p.valorUnitario || p.valorUnitario < 0) {
        errors.push(`Item ${idx}: valor unitário inválido`);
      }

      // Impostos
      if (!item.imposto) {
        errors.push(`Item ${idx}: dados de impostos são obrigatórios`);
        return;
      }

      // ICMS
      if (!item.imposto.icms) {
        errors.push(`Item ${idx}: dados de ICMS são obrigatórios`);
      } else {
        const icms = item.imposto.icms;

        // Origem
        if (!icms.orig || !/^[0-7]$/.test(icms.orig)) {
          errors.push(`Item ${idx}: origem do ICMS inválida (0-7)`);
        }

        // CST ou CSOSN
        const crt = req.emitente?.crt;
        if (crt === '1' || crt === '2') {
          // Simples Nacional
          if (!icms.csosn) {
            errors.push(`Item ${idx}: CSOSN obrigatório para Simples Nacional`);
          }
        } else if (crt === '3') {
          // Regime Normal
          if (!icms.cst) {
            errors.push(`Item ${idx}: CST ICMS obrigatório para Regime Normal`);
          }
        }

        // Validar campos conforme CST/CSOSN
        const situacao = icms.cst || icms.csosn;
        if (situacao) {
          // Tributados: precisam de modBC, vBC, pICMS, vICMS
          const tributados = ['00', '10', '20', '51', '70', '90', '101', '201', '900'];
          if (tributados.includes(situacao)) {
            if (icms.valorBC !== undefined && icms.valorBC > 0) {
              if (!icms.modBC) {
                errors.push(`Item ${idx}: modalidade BC obrigatória para ICMS tributado`);
              }
              if (!icms.aliquota && icms.aliquota !== 0) {
                errors.push(`Item ${idx}: alíquota ICMS obrigatória quando há BC`);
              }

              // Validar cálculo
              if (icms.valorBC && icms.aliquota !== undefined && icms.valor !== undefined) {
                if (!validateTaxCalculation(icms.valorBC, icms.aliquota, icms.valor)) {
                  errors.push(`Item ${idx}: valor ICMS inconsistente (esperado ${(icms.valorBC * icms.aliquota / 100).toFixed(2)})`);
                }
              }
            }
          }

          // ST: precisam de modBCST, vBCST, pICMSST, vICMSST
          const comST = ['10', '30', '70', '90', '201', '202', '203', '900'];
          if (comST.includes(situacao) && icms.valorBCST !== undefined && icms.valorBCST > 0) {
            if (!icms.modBCST) {
              errors.push(`Item ${idx}: modalidade BC ST obrigatória`);
            }

            // Validar cálculo ST
            if (icms.valorBCST && icms.aliquotaST !== undefined && icms.valorST !== undefined) {
              if (!validateTaxCalculation(icms.valorBCST, icms.aliquotaST, icms.valorST)) {
                errors.push(`Item ${idx}: valor ICMS ST inconsistente (esperado ${(icms.valorBCST * icms.aliquotaST / 100).toFixed(2)})`);
              }
            }
          }
        }
      }

      // PIS
      if (!item.imposto.pis || !item.imposto.pis.cst) {
        errors.push(`Item ${idx}: CST do PIS é obrigatório`);
      } else {
        const pis = item.imposto.pis;
        // Validar cálculo PIS para CST tributados
        if (['01', '02'].includes(pis.cst)) {
          if (pis.valorBC && pis.aliquota !== undefined && pis.valor !== undefined) {
            if (!validateTaxCalculation(pis.valorBC, pis.aliquota, pis.valor)) {
              errors.push(`Item ${idx}: valor PIS inconsistente (esperado ${(pis.valorBC * pis.aliquota / 100).toFixed(2)})`);
            }
          }
        }
      }

      // COFINS
      if (!item.imposto.cofins || !item.imposto.cofins.cst) {
        errors.push(`Item ${idx}: CST do COFINS é obrigatório`);
      } else {
        const cofins = item.imposto.cofins;
        // Validar cálculo COFINS para CST tributados
        if (['01', '02'].includes(cofins.cst)) {
          if (cofins.valorBC && cofins.aliquota !== undefined && cofins.valor !== undefined) {
            if (!validateTaxCalculation(cofins.valorBC, cofins.aliquota, cofins.valor)) {
              errors.push(`Item ${idx}: valor COFINS inconsistente (esperado ${(cofins.valorBC * cofins.aliquota / 100).toFixed(2)})`);
            }
          }
        }
      }

      // IPI (se presente)
      if (item.imposto.ipi) {
        if (!item.imposto.ipi.cst) {
          errors.push(`Item ${idx}: CST do IPI é obrigatório`);
        }
        if (!item.imposto.ipi.cEnq) {
          errors.push(`Item ${idx}: código de enquadramento IPI é obrigatório`);
        }

        // Validar cálculo IPI
        const ipi = item.imposto.ipi;
        if (['00', '49', '50', '99'].includes(ipi.cst)) {
          if (ipi.valorBC && ipi.aliquota !== undefined && ipi.valor !== undefined) {
            if (!validateTaxCalculation(ipi.valorBC, ipi.aliquota, ipi.valor)) {
              errors.push(`Item ${idx}: valor IPI inconsistente (esperado ${(ipi.valorBC * ipi.aliquota / 100).toFixed(2)})`);
            }
          }
        }
      }
    });
  }

  // Validar pagamento
  if (!req.pagamento || !req.pagamento.formas || req.pagamento.formas.length === 0) {
    errors.push('Formas de pagamento são obrigatórias');
  }

  return errors;
}

/**
 * Interpreta o status da SEFAZ e retorna o status padronizado
 */
function interpretarStatus(cStat: string): SefazResponse['status'] {
  const code = parseInt(cStat, 10);

  // 100 = Autorizada, 150 = Autorizada fora de prazo
  if (code === 100 || code === 150) return 'autorizado';

  // 105 = Lote em processamento
  if (code === 105) return 'processando';

  // 110 = Uso denegado
  if (code === 110 || code === 301 || code === 302 || code === 303) return 'denegado';

  // 135 = Evento registrado e vinculado
  if (code === 135 || code === 136) return 'autorizado';

  // 101 = Cancelamento homologado
  // 155 = Cancelamento homologado fora de prazo — SUCESSO com ressalva
  //       (o evento FOI registrado; o xMotivo carrega a ressalva)
  if (code === 101 || code === 155) return 'autorizado';

  // 102 = Inutilização homologada
  if (code === 102) return 'autorizado';

  // 107 = Serviço em operação
  if (code === 107) return 'autorizado';

  // Rejeições (200-999)
  if (code >= 200) return 'rejeitado';

  return 'erro';
}

/**
 * Extrai dados relevantes do retorno da autorização
 */
function parseRetAutorizacao(retorno: any): SefazResponse {
  // Pode vir como retEnviNFe ou retConsReciNFe
  const ret = retorno['retEnviNFe'] || retorno['retConsReciNFe'] || retorno;

  const cStat = String(ret['cStat'] || '');
  const xMotivo = String(ret['xMotivo'] || '');

  // Se cStat=104, verificar protNFe individual
  if (cStat === '104' || ret['protNFe']) {
    const protNFe = ret['protNFe'];
    if (protNFe) {
      const infProt = protNFe['infProt'] || protNFe;
      const protStat = String(infProt['cStat'] || '');
      const protMotivo = String(infProt['xMotivo'] || '');

      return {
        success: protStat === '100' || protStat === '150',
        status: interpretarStatus(protStat),
        codigoStatus: protStat,
        motivoStatus: protMotivo,
        chaveAcesso: String(infProt['chNFe'] || ''),
        protocolo: String(infProt['nProt'] || ''),
        dataRecebimento: String(infProt['dhRecbto'] || ''),
      };
    }
  }

  // Resposta síncrona (NFCe indSinc=1) com cStat=100
  if (cStat === '100' || cStat === '150') {
    const protNFe = ret['protNFe'];
    if (protNFe) {
      const infProt = protNFe['infProt'] || protNFe;
      return {
        success: true,
        status: 'autorizado',
        codigoStatus: String(infProt['cStat'] || cStat),
        motivoStatus: String(infProt['xMotivo'] || xMotivo),
        chaveAcesso: String(infProt['chNFe'] || ''),
        protocolo: String(infProt['nProt'] || ''),
        dataRecebimento: String(infProt['dhRecbto'] || ''),
      };
    }
  }

  // Lote em processamento
  if (cStat === '103' || cStat === '105') {
    return {
      success: false,
      status: 'processando',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      nRec: String(ret['infRec']?.['nRec'] || ''),
    };
  }

  // Retorno com recibo (para polling)
  if (ret['infRec']) {
    return {
      success: false,
      status: 'processando',
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      nRec: String(ret['infRec']['nRec'] || ''),
    };
  }

  return {
    success: false,
    status: interpretarStatus(cStat),
    codigoStatus: cStat,
    motivoStatus: xMotivo,
    erros: [xMotivo],
  };
}

/**
 * Monta o envelope <nfeProc> (XML autorizado padrão SEFAZ).
 * O <nfeProc> agrupa <NFe> + <protNFe> e é o formato salvo pelo emissor
 * após autorização — necessário para geração do DANFE.
 */
/** Exportada para testes unitários (pura, sem I/O). */
export function buildNfeProcEnvelope(signedXml: string, resultado: SefazResponse, tpAmb: '1' | '2'): string {
  // O XML assinado carrega o prólogo <?xml?> — não pode aparecer no meio do
  // nfeProc (documento ficaria malformado para qualquer parser estrito).
  const nfeMatch = signedXml.match(/<NFe[\s>][\s\S]*<\/NFe>/);
  const nfeContent = nfeMatch ? nfeMatch[0] : signedXml.replace(/<\?xml[^>]*\?>\s*/, '');

  // protNFe literal retornado pela SEFAZ (verAplic/digVal reais). O fallback
  // reconstruído só cobre resposta sem o fragmento — sem verAplic/digVal
  // oficiais o documento não é o protocolo registrado, mas continua well-formed.
  const protNFe =
    resultado.protNFeXml ||
    `<protNFe versao="4.00">` +
      `<infProt>` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<verAplic>SefazAPI-1.0</verAplic>` +
      `<chNFe>${resultado.chaveAcesso || ''}</chNFe>` +
      `<dhRecbto>${resultado.dataRecebimento || ''}</dhRecbto>` +
      `<nProt>${resultado.protocolo || ''}</nProt>` +
      `<cStat>${resultado.codigoStatus}</cStat>` +
      `<xMotivo>${escapeXml(resultado.motivoStatus)}</xMotivo>` +
      `</infProt>` +
      `</protNFe>`;

  return `<nfeProc versao="4.00" xmlns="${SEFAZ_NS}">` + nfeContent + protNFe + `</nfeProc>`;
}

/**
 * Extrai o fragmento <protNFe> literal da resposta SOAP da SEFAZ.
 * Usado para montar o nfeProc com o protocolo oficial em vez de reconstruí-lo.
 */
export function extrairProtNFe(soapXml: string): string | undefined {
  const m = soapXml.match(/<protNFe[\s>][\s\S]*?<\/protNFe>/);
  return m ? m[0] : undefined;
}

/** cStat de nota com protocolo que precisa ser guardada: autorizada (100, 150) ou denegada. */
const COM_PROTOCOLO = ['100', '150', '110', '301', '302', '303'];

/** cStat da consulta de nota cancelada (101; 151 e 155 fora de prazo). */
const CANCELADA = ['101', '151', '155'];

/**
 * Monta o procEventoNFe (evento assinado + retEvento literal da SEFAZ) — o XML do
 * cancelamento ou da CC-e que o emissor guarda por 5 anos, junto do nfeProc.
 * `undefined` se a resposta não trouxe o retEvento. Exportada para testes (pura).
 */
export function montarProcEventoNFe(envEventoAssinado: string, soapXml: string): string | undefined {
  const evento = envEventoAssinado.match(/<evento[\s>][\s\S]*?<\/evento>/);
  const retEvento = soapXml.match(/<retEvento[\s>][\s\S]*?<\/retEvento>/);
  if (!evento || !retEvento) return undefined;
  return `<procEventoNFe versao="1.00" xmlns="${SEFAZ_NS}">` + evento[0] + retEvento[0] + `</procEventoNFe>`;
}

/**
 * Monta o procInutNFe (pedido assinado + retInutNFe literal) — a prova da inutilização,
 * guardada por 5 anos. `undefined` se a resposta não trouxe o retInutNFe. Exportada para
 * testes (pura).
 */
export function montarProcInutNFe(inutAssinado: string, soapXml: string): string | undefined {
  const inut = inutAssinado.match(/<inutNFe[\s>][\s\S]*<\/inutNFe>/);
  const ret = soapXml.match(/<retInutNFe[\s>][\s\S]*?<\/retInutNFe>/);
  if (!inut || !ret) return undefined;
  return `<procInutNFe versao="4.00" xmlns="${SEFAZ_NS}">` + inut[0] + ret[0] + `</procInutNFe>`;
}

/**
 * O procEventoNFe do cancelamento (110111, ou 110112 por substituição) registrado,
 * entre os eventos que a consulta da nota devolve. Sai com o namespace na raiz, para
 * ser guardado sozinho. Exportada para testes (pura).
 */
export function extrairProcCancelamento(soapXml: string): string | undefined {
  for (const m of soapXml.matchAll(/<procEventoNFe[\s>][\s\S]*?<\/procEventoNFe>/g)) {
    const proc = m[0];
    const tipo = proc.match(/<tpEvento>(\d+)<\/tpEvento>/)?.[1];
    const ret = proc.match(/<retEvento[\s>][\s\S]*?<\/retEvento>/)?.[0] ?? '';
    const cStat = ret.match(/<cStat>(\d+)<\/cStat>/)?.[1];
    if ((tipo === '110111' || tipo === '110112') && ['135', '136', '155'].includes(cStat ?? '')) {
      const abertura = proc.match(/^<procEventoNFe[^>]*>/)![0];
      return abertura.includes('xmlns=')
        ? proc
        : proc.replace(abertura, abertura.replace('<procEventoNFe', `<procEventoNFe xmlns="${SEFAZ_NS}"`));
    }
  }
  return undefined;
}

/**
 * O nfeProc de uma consulta: a NF-e que o emissor assinou + o protNFe literal da consulta.
 * Só quando o XML é mesmo o da nota consultada — mesma chave e mesmo digest que a SEFAZ
 * registrou no protocolo. Exportada para testes (pura).
 */
export function nfeProcDaConsulta(
  xmlAssinado: string,
  chaveAcesso: string,
  soapXml: string,
  tpAmb: '1' | '2',
): string | undefined {
  const protNFe = extrairProtNFe(soapXml);
  if (!protNFe) return undefined;
  const cStat = protNFe.match(/<cStat>(\d+)<\/cStat>/)?.[1] ?? '';
  if (!COM_PROTOCOLO.includes(cStat)) return undefined;
  if (xmlAssinado.match(/Id="NFe(\d{44})"/)?.[1] !== chaveAcesso) return undefined;
  const digVal = protNFe.match(/<digVal>([^<]+)<\/digVal>/)?.[1];
  const digest = xmlAssinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1];
  if (digVal && digest && digVal !== digest) return undefined;
  return buildNfeProcEnvelope(
    xmlAssinado,
    { success: true, status: 'autorizado', codigoStatus: cStat, motivoStatus: '', protNFeXml: protNFe },
    tpAmb,
  );
}

/**
 * Envolve a NFe assinada no envelope enviNFe para autorização
 */
function wrapEnviNFe(signedXml: string, loteId: string, indSinc: '0' | '1'): string {
  // Extrair apenas o conteúdo <NFe>...</NFe> do XML assinado
  const nfeMatch = signedXml.match(/<NFe\s[^]*<\/NFe>/);
  if (!nfeMatch) {
    throw new Error('Não foi possível extrair o elemento NFe do XML assinado');
  }
  const nfeContent = nfeMatch[0];

  return `<nfeDadosMsg xmlns="${AUTORIZACAO_NS}">` +
    `<enviNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
    `<idLote>${loteId}</idLote>` +
    `<indSinc>${indSinc}</indSinc>` +
    nfeContent +
    `</enviNFe>` +
    `</nfeDadosMsg>`;
}

/**
 * Gera chave de acesso e número para uma nota
 */
function gerarChaveENumero(params: {
  ufEmitente: string;
  cnpj: string;
  modelo: '55' | '65';
  serie: string;
  numero?: number;
  /** Tipo de emissão SEFAZ: '1'=Normal, '6'=SVC-AN, '7'=SVC-RS, '9'=Contingência NFC-e off-line. Default '1'. */
  tipoEmissao?: string;
}): { chaveAcesso: string; numero: number; codigoNumerico: string } {
  const { ufEmitente, cnpj, modelo, serie } = params;

  const cUF = UF_CODES[ufEmitente.toUpperCase()];
  if (!cUF) {
    throw new Error(`UF inválida: ${ufEmitente}`);
  }

  const codigoNumerico = gerarCodigoNumerico();
  if (!params.numero) {
    throw new Error('numero da nota é obrigatório (deve ser sequencial, controlado pelo emissor)');
  }
  const numero = params.numero;

  const chaveAcesso = montarChaveAcesso({
    cUF,
    dataEmissao: new Date(),
    cnpj: apenasNumeros(cnpj),
    modelo,
    serie,
    numero,
    tipoEmissao: params.tipoEmissao || '1',
    codigoNumerico,
    uf: ufEmitente,
  });

  return { chaveAcesso, numero, codigoNumerico };
}

// ============================================================
// Funções principais do serviço
// ============================================================

/**
 * Emite uma NFe (modelo 55) - assíncrono com polling
 */
export async function emitirNFe(request: NFeRequest): Promise<SefazResponse> {
  // Disponível no catch: se a chave já foi gerada antes do erro, devolvê-la
  // permite ao emissor consultar/recuperar a nota em vez de re-emitir às cegas.
  let chaveGerada: string | undefined;
  // O XML que foi à SEFAZ — volta no desfecho incerto para a consulta montar o nfeProc.
  let xmlEnviado: string | undefined;
  try {
    // VALIDAÇÃO ANTES DE GERAR XML
    const validationErrors = validateNFePayload(request);
    if (validationErrors.length > 0) {
      return {
        success: false,
        status: 'erro',
        codigoStatus: '400',
        motivoStatus: 'Dados inválidos: ' + validationErrors.join('; '),
        erros: validationErrors,
      };
    }

    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';
    const serie = request.serie || '1';

    // 1. Gerar chave de acesso
    const { chaveAcesso, numero } = gerarChaveENumero({
      ufEmitente: request.ufEmitente,
      cnpj: request.emitente.cnpj,
      modelo: '55',
      serie,
      numero: request.numero,
    });
    chaveGerada = chaveAcesso;

    // 2. Construir o XML da NFe
    const nfeXml = buildNFeXml(request, chaveAcesso, numero, tpAmb);

    // 3. Assinar o XML
    const signedXml = assinarXml(nfeXml, request.certificado, 'infNFe');

    // 4. Envelopar no enviNFe (síncrono: indSinc=1 para lote com 1 NF-e)
    const loteId = gerarIdLote();
    const soapBody = wrapEnviNFe(signedXml, loteId, '1');
    xmlEnviado = signedXml;

    // 5. Obter endpoint e enviar
    const endpoints = getNFeEndpoints(request.ufEmitente, ambiente);
    const soapResponse = await enviarSoap(
      endpoints.autorizacao,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
      soapBody,
      request.certificado,
    );

    // 6. Parsear resposta inicial
    const retorno = extrairRetorno(soapResponse);
    const resultado = parseRetAutorizacao(retorno);
    resultado.protNFeXml = extrairProtNFe(soapResponse);

    // 7. Se está processando, fazer polling
    if (resultado.status === 'processando' && resultado.nRec) {
      const nRec = resultado.nRec;
      const pollingResult = await pollRetAutorizacao(
        nRec,
        request.ufEmitente,
        ambiente,
        request.certificado,
      );

      // Chave gerada localmente (cNF aleatório) volta em TODOS os caminhos —
      // timeout/processando sem ela deixaria o emissor sem como consultar uma
      // nota que a SEFAZ pode ter autorizado.
      if (!pollingResult.chaveAcesso) {
        pollingResult.chaveAcesso = chaveAcesso;
      }
      if (!pollingResult.nRec) {
        pollingResult.nRec = nRec;
      }

      completarXmls(pollingResult, signedXml, tpAmb);
      return pollingResult;
    }

    // Se já tem resultado definitivo
    if (!resultado.chaveAcesso) {
      resultado.chaveAcesso = chaveAcesso;
    }
    completarXmls(resultado, signedXml, tpAmb);
    return resultado;
  } catch (error: any) {
    if (naoChegouASefaz(error)) return naoEnviado(error);
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro desconhecido ao emitir NFe',
      erros: [error.message],
      chaveAcesso: chaveGerada,
      xmlAssinado: xmlEnviado,
    };
  }
}

/**
 * Os XMLs da resposta de uma emissão: o nfeProc da nota autorizada ou denegada (a denegada
 * também é guardada, com o protocolo da denegação), e o XML assinado quando o desfecho
 * ficou incerto — para a consulta montar o nfeProc depois.
 */
function completarXmls(resultado: SefazResponse, signedXml: string, tpAmb: '1' | '2'): void {
  if (resultado.success || resultado.status === 'denegado') {
    resultado.xml = buildNfeProcEnvelope(signedXml, resultado, tpAmb);
  } else if (resultado.status === 'processando' || resultado.status === 'erro') {
    resultado.xmlAssinado = signedXml;
  }
  delete resultado.protNFeXml;
}

/**
 * Polling de retorno da autorização (NFe assíncrona)
 */
async function pollRetAutorizacao(
  nRec: string,
  ufEmitente: string,
  ambiente: 'producao' | 'homologacao',
  certificado: CertificateData,
): Promise<SefazResponse> {
  const tpAmb = ambiente === 'producao' ? '1' : '2';
  const endpoints = getNFeEndpoints(ufEmitente, ambiente);

  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    await sleep(POLLING_INTERVAL_MS);

    const soapBody =
      `<nfeDadosMsg xmlns="${RET_AUTORIZACAO_NS}">` +
      `<consReciNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<nRec>${nRec}</nRec>` +
      `</consReciNFe>` +
      `</nfeDadosMsg>`;

    try {
      const soapResponse = await enviarSoap(
        endpoints.retAutorizacao,
        'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4/nfeRetAutorizacaoLote',
        soapBody,
        certificado,
      );

      const retorno = extrairRetorno(soapResponse);
      const resultado = parseRetAutorizacao(retorno);
      resultado.protNFeXml = extrairProtNFe(soapResponse);

      // Se não está mais processando, retornar
      if (resultado.status !== 'processando') {
        return resultado;
      }
    } catch (error: any) {
      // Continuar tentando em caso de erro transitório
      if (attempt === MAX_POLLING_ATTEMPTS - 1) {
        // O lote JÁ foi recebido pela SEFAZ (temos nRec) — a nota pode ter
        // sido autorizada. 'processando' (não 'erro') faz o emissor commitar
        // o número e consultar depois, em vez de reusar o nNF (rejeição 539).
        return {
          success: false,
          status: 'processando',
          codigoStatus: 'TIMEOUT',
          motivoStatus: `Lote recebido (nRec ${nRec}), mas a consulta do resultado falhou após ${MAX_POLLING_ATTEMPTS} tentativas: ${error.message}. Consulte pela chave de acesso.`,
          erros: [error.message],
          nRec,
        };
      }
    }
  }

  return {
    success: false,
    status: 'processando',
    codigoStatus: '105',
    motivoStatus: 'Lote ainda em processamento após todas as tentativas de polling',
    nRec,
  };
}

/**
 * Valida payload de NFC-e antes de gerar XML
 */
function validateNFCePayload(req: NFCeRequest): string[] {
  const errors: string[] = [];

  // Validar campos básicos
  if (!req.numero) errors.push('Número da NFC-e é obrigatório');
  if (!req.ufEmitente || !/^[A-Z]{2}$/.test(req.ufEmitente)) {
    errors.push('UF do emitente inválida');
  }

  // Validar emitente
  if (!req.emitente) {
    errors.push('Dados do emitente são obrigatórios');
  } else {
    if (!req.emitente.cnpj) errors.push('CNPJ do emitente é obrigatório');
    if (!req.emitente.inscricaoEstadual) errors.push('IE do emitente é obrigatória');
    if (!req.emitente.crt || !['1','2','3'].includes(req.emitente.crt)) {
      errors.push('CRT do emitente inválido (1, 2 ou 3)');
    }
  }

  // Validar CSC (obrigatório para NFCe)
  if (!req.csc || !req.csc.id || !req.csc.token) {
    errors.push('CSC (Código de Segurança do Contribuinte) é obrigatório para NFC-e');
  }

  // Validar itens (mesma lógica da NFe)
  if (!req.itens || req.itens.length === 0) {
    errors.push('NFC-e deve ter ao menos 1 item');
  } else {
    req.itens.forEach((item, i) => {
      const idx = i + 1;

      if (!item.produto) {
        errors.push(`Item ${idx}: dados do produto são obrigatórios`);
        return;
      }

      const p = item.produto;

      if (!p.ncm || !/^\d{8}$/.test(p.ncm)) {
        errors.push(`Item ${idx}: NCM inválido (deve ter 8 dígitos)`);
      }

      if (!p.cfop || !/^\d{4}$/.test(p.cfop)) {
        errors.push(`Item ${idx}: CFOP inválido (deve ter 4 dígitos)`);
      }

      if (p.cest && !/^\d{7}$/.test(p.cest)) {
        errors.push(`Item ${idx}: CEST inválido (deve ter 7 dígitos)`);
      }

      if (!p.descricao || p.descricao.trim().length === 0) {
        errors.push(`Item ${idx}: descrição do produto é obrigatória`);
      }

      if (!p.quantidade || p.quantidade <= 0) {
        errors.push(`Item ${idx}: quantidade deve ser maior que zero`);
      }
      if (!p.valorUnitario || p.valorUnitario < 0) {
        errors.push(`Item ${idx}: valor unitário inválido`);
      }

      if (!item.imposto) {
        errors.push(`Item ${idx}: dados de impostos são obrigatórios`);
        return;
      }

      if (!item.imposto.icms) {
        errors.push(`Item ${idx}: dados de ICMS são obrigatórios`);
      } else {
        const icms = item.imposto.icms;

        if (!icms.orig || !/^[0-7]$/.test(icms.orig)) {
          errors.push(`Item ${idx}: origem do ICMS inválida (0-7)`);
        }

        const crt = req.emitente?.crt;
        if (crt === '1' || crt === '2') {
          if (!icms.csosn) {
            errors.push(`Item ${idx}: CSOSN obrigatório para Simples Nacional`);
          }
        } else if (crt === '3') {
          if (!icms.cst) {
            errors.push(`Item ${idx}: CST ICMS obrigatório para Regime Normal`);
          }
        }

        const situacao = icms.cst || icms.csosn;
        if (situacao) {
          const tributados = ['00', '10', '20', '51', '70', '90', '101', '201', '900'];
          if (tributados.includes(situacao)) {
            if (icms.valorBC !== undefined && icms.valorBC > 0) {
              if (!icms.modBC) {
                errors.push(`Item ${idx}: modalidade BC obrigatória para ICMS tributado`);
              }
              if (!icms.aliquota && icms.aliquota !== 0) {
                errors.push(`Item ${idx}: alíquota ICMS obrigatória quando há BC`);
              }

              if (icms.valorBC && icms.aliquota !== undefined && icms.valor !== undefined) {
                if (!validateTaxCalculation(icms.valorBC, icms.aliquota, icms.valor)) {
                  errors.push(`Item ${idx}: valor ICMS inconsistente (esperado ${(icms.valorBC * icms.aliquota / 100).toFixed(2)})`);
                }
              }
            }
          }

          const comST = ['10', '30', '70', '90', '201', '202', '203', '900'];
          if (comST.includes(situacao) && icms.valorBCST !== undefined && icms.valorBCST > 0) {
            if (!icms.modBCST) {
              errors.push(`Item ${idx}: modalidade BC ST obrigatória`);
            }

            if (icms.valorBCST && icms.aliquotaST !== undefined && icms.valorST !== undefined) {
              if (!validateTaxCalculation(icms.valorBCST, icms.aliquotaST, icms.valorST)) {
                errors.push(`Item ${idx}: valor ICMS ST inconsistente (esperado ${(icms.valorBCST * icms.aliquotaST / 100).toFixed(2)})`);
              }
            }
          }
        }
      }

      if (!item.imposto.pis || !item.imposto.pis.cst) {
        errors.push(`Item ${idx}: CST do PIS é obrigatório`);
      } else {
        const pis = item.imposto.pis;
        if (['01', '02'].includes(pis.cst)) {
          if (pis.valorBC && pis.aliquota !== undefined && pis.valor !== undefined) {
            if (!validateTaxCalculation(pis.valorBC, pis.aliquota, pis.valor)) {
              errors.push(`Item ${idx}: valor PIS inconsistente (esperado ${(pis.valorBC * pis.aliquota / 100).toFixed(2)})`);
            }
          }
        }
      }

      if (!item.imposto.cofins || !item.imposto.cofins.cst) {
        errors.push(`Item ${idx}: CST do COFINS é obrigatório`);
      } else {
        const cofins = item.imposto.cofins;
        if (['01', '02'].includes(cofins.cst)) {
          if (cofins.valorBC && cofins.aliquota !== undefined && cofins.valor !== undefined) {
            if (!validateTaxCalculation(cofins.valorBC, cofins.aliquota, cofins.valor)) {
              errors.push(`Item ${idx}: valor COFINS inconsistente (esperado ${(cofins.valorBC * cofins.aliquota / 100).toFixed(2)})`);
            }
          }
        }
      }

      if (item.imposto.ipi) {
        if (!item.imposto.ipi.cst) {
          errors.push(`Item ${idx}: CST do IPI é obrigatório`);
        }
        if (!item.imposto.ipi.cEnq) {
          errors.push(`Item ${idx}: código de enquadramento IPI é obrigatório`);
        }

        const ipi = item.imposto.ipi;
        if (['00', '49', '50', '99'].includes(ipi.cst)) {
          if (ipi.valorBC && ipi.aliquota !== undefined && ipi.valor !== undefined) {
            if (!validateTaxCalculation(ipi.valorBC, ipi.aliquota, ipi.valor)) {
              errors.push(`Item ${idx}: valor IPI inconsistente (esperado ${(ipi.valorBC * ipi.aliquota / 100).toFixed(2)})`);
            }
          }
        }
      }
    });
  }

  // Validar pagamento
  if (!req.pagamento || !req.pagamento.formas || req.pagamento.formas.length === 0) {
    errors.push('Formas de pagamento são obrigatórias');
  }

  return errors;
}

/**
 * Emite uma NFCe (modelo 65) - síncrono (indSinc=1)
 */
export async function emitirNFCe(request: NFCeRequest): Promise<SefazResponse> {
  let chaveGerada: string | undefined;
  let xmlEnviado: string | undefined;
  try {
    // Guarda: payload com `contingencia` aqui geraria chave com tpEmis=1 e
    // XML com tpEmis=9 (buildNFCeXml lê request.contingencia) → rejeição 502
    // garantida. Contingência off-line tem endpoint próprio.
    if (request.contingencia) {
      return {
        success: false,
        status: 'erro',
        codigoStatus: '400',
        motivoStatus:
          'Payload com `contingencia` não é aceito em /nfce/emitir (emissão normal, tpEmis=1). ' +
          'Use /nfe/nfce/contingencia/prepare para contingência off-line.',
        erros: ['contingencia presente em emissão normal'],
      };
    }

    // VALIDAÇÃO ANTES DE GERAR XML
    const validationErrors = validateNFCePayload(request);
    if (validationErrors.length > 0) {
      return {
        success: false,
        status: 'erro',
        codigoStatus: '400',
        motivoStatus: 'Dados inválidos: ' + validationErrors.join('; '),
        erros: validationErrors,
      };
    }

    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';
    const serie = request.serie || '1';

    // 1. Gerar chave de acesso
    const { chaveAcesso, numero } = gerarChaveENumero({
      ufEmitente: request.ufEmitente,
      cnpj: request.emitente.cnpj,
      modelo: '65',
      serie,
      numero: request.numero,
    });
    chaveGerada = chaveAcesso;

    // 2. Construir o XML da NFCe
    const nfceXml = buildNFCeXml(request, chaveAcesso, numero, tpAmb);

    // 3. Assinar o XML
    let signedXml = assinarXml(nfceXml, request.certificado, 'infNFe');

    // 4. Inserir infNFeSupl após assinatura (deve ficar entre </infNFe> e <Signature>, conforme XSD)
    const nfceSupl = buildNFCeSupl(chaveAcesso, tpAmb, request.csc, request.ufEmitente);
    signedXml = signedXml.replace('<Signature', `${nfceSupl}<Signature`);

    // 5. Envelopar no enviNFe (síncrono: indSinc=1)
    const loteId = gerarIdLote();
    const soapBody = wrapEnviNFe(signedXml, loteId, '1');
    xmlEnviado = signedXml;

    // 6. Obter endpoint e enviar
    const endpoints = getNFCeEndpoints(request.ufEmitente, ambiente);
    const soapResponse = await enviarSoap(
      endpoints.autorizacao,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
      soapBody,
      request.certificado,
    );

    // 7. Parsear resposta (síncrona - resultado imediato)
    const retorno = extrairRetorno(soapResponse);
    const resultado = parseRetAutorizacao(retorno);
    resultado.protNFeXml = extrairProtNFe(soapResponse);

    // Chave gerada localmente volta em TODOS os caminhos (ver emitirNFe).
    if (!resultado.chaveAcesso) {
      resultado.chaveAcesso = chaveAcesso;
    }
    completarXmls(resultado, signedXml, tpAmb);
    return resultado;
  } catch (error: any) {
    if (naoChegouASefaz(error)) return naoEnviado(error);
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro desconhecido ao emitir NFCe',
      erros: [error.message],
      chaveAcesso: chaveGerada,
      xmlAssinado: xmlEnviado,
    };
  }
}

/**
 * A emissão que não chegou à SEFAZ: sem chave e sem XML assinado (a nota não existe lá, não há
 * o que consultar) — o emissor pode reenviar com o mesmo número, ou ir em contingência com ele.
 */
function naoEnviado(error: Error): SefazResponse {
  return {
    success: false,
    status: 'erro',
    codigoStatus: 'ERR',
    motivoStatus: error.message,
    erros: [error.message],
    naoEnviado: true,
  };
}

/**
 * Prepara NFC-e em contingência off-line (tpEmis=9). Gera chave própria,
 * monta XML com dhCont+xJust, assina, insere infNFeSupl com QR Code no
 * formato off-line — mas NÃO transmite pra SEFAZ. O emissor armazena o XML
 * assinado + chave e imprime DANFCE com aviso "EM CONTINGÊNCIA". A
 * transmissão acontece via transmitirNFCeContingencia quando a SEFAZ volta
 * (até 24h após dhCont).
 *
 * Pré-condição: request.contingencia tem que estar preenchido com
 * { dhCont, xJust }. xJust precisa ter 15-256 caracteres.
 */
export async function prepararNFCeContingencia(
  request: NFCeRequest,
): Promise<{ success: boolean; chaveAcesso?: string; xml?: string; numero?: number; status: string; motivoStatus?: string; erros?: string[] }> {
  try {
    if (!request.contingencia) {
      return { success: false, status: 'erro', motivoStatus: 'contingencia obrigatória neste endpoint', erros: ['contingencia ausente'] };
    }
    const { xJust } = request.contingencia;
    if (!xJust || xJust.length < 15 || xJust.length > 256) {
      return { success: false, status: 'erro', motivoStatus: 'xJust deve ter 15-256 caracteres', erros: ['xJust inválido'] };
    }

    const validationErrors = validateNFCePayload(request);
    if (validationErrors.length > 0) {
      return {
        success: false,
        status: 'erro',
        motivoStatus: 'Dados inválidos: ' + validationErrors.join('; '),
        erros: validationErrors,
      };
    }

    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';
    const serie = request.serie || '1';

    // Chave de acesso com tpEmis='9' (contingência off-line).
    const { chaveAcesso, numero } = gerarChaveENumero({
      ufEmitente: request.ufEmitente,
      cnpj: request.emitente.cnpj,
      modelo: '65',
      serie,
      numero: request.numero,
      tipoEmissao: '9',
    });

    // Monta XML com tpEmis=9 + dhCont + xJust (vem de request.contingencia).
    const nfceXml = buildNFCeXml(request, chaveAcesso, numero, tpAmb);

    // Assina e DEPOIS insere infNFeSupl. O QR Code é OBRIGATÓRIO inclusive em
    // contingência off-line: infNFeSupl é grupo obrigatório do modelo 65 e a
    // transmissão posterior seria rejeitada por schema sem ele. Na emissão
    // off-line o QR v3 (NT 2025.001) assina os parâmetros
    // (chNFe|3|tpAmb|dia|vNF|tpIdDest|cDest) com a chave privada do
    // certificado do emitente — CSC e DigestValue saíram do leiaute v3.
    const signedSemSupl = assinarXml(nfceXml, request.certificado, 'infNFe');

    const dhEmiMatch = signedSemSupl.match(/<dhEmi>([^<]+)<\/dhEmi>/);
    const vNFMatch = signedSemSupl.match(/<vNF>([^<]+)<\/vNF>/);
    if (!dhEmiMatch || !vNFMatch) {
      throw new Error('dhEmi/vNF não encontrados no XML — impossível gerar QR Code de contingência');
    }

    const nfceSupl = buildNFCeSuplContingencia({
      chaveAcesso,
      tpAmb,
      uf: request.ufEmitente,
      dhEmi: dhEmiMatch[1],
      vNF: vNFMatch[1],
      certificado: request.certificado,
      consumidor: request.consumidor,
    });

    // Entre </infNFe> e <Signature>, conforme XSD (mesma técnica do emitirNFCe).
    const signedXml = signedSemSupl.replace('<Signature', `${nfceSupl}<Signature`);

    return {
      success: true,
      status: 'contingencia',
      chaveAcesso,
      numero,
      xml: signedXml,
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      motivoStatus: error.message || 'Erro desconhecido ao preparar NFC-e em contingência',
      erros: [error.message],
    };
  }
}

/**
 * Transmite NFC-e em contingência (XML já assinado pelo prepararNFCeContingencia)
 * pra SEFAZ. Operador chama isso quando SEFAZ volta — preferencialmente em até
 * 24h após dhCont, senão a SEFAZ pode rejeitar por extemporaneidade.
 */
export async function transmitirNFCeContingencia(
  signedXml: string,
  ufEmitente: string,
  certificado: NFCeRequest['certificado'],
  ambiente?: 'producao' | 'homologacao',
): Promise<SefazResponse> {
  try {
    const resolvedAmbiente = ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = resolvedAmbiente === 'producao' ? '1' : '2';

    const loteId = gerarIdLote();
    const soapBody = wrapEnviNFe(signedXml, loteId, '1');

    const endpoints = getNFCeEndpoints(ufEmitente, resolvedAmbiente);
    const soapResponse = await enviarSoap(
      endpoints.autorizacao,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
      soapBody,
      certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    const resultado = parseRetAutorizacao(retorno);
    resultado.protNFeXml = extrairProtNFe(soapResponse);

    // Chave vem do XML assinado (Id="NFe<44 dígitos>") — devolver mesmo em
    // rejeição/timeout para o emissor manter o vínculo com o doc local.
    if (!resultado.chaveAcesso) {
      const idMatch = signedXml.match(/Id="NFe(\d{44})"/);
      if (idMatch) resultado.chaveAcesso = idMatch[1];
    }

    // O emissor já guarda o XML assinado (veio do prepare): o xmlAssinado não volta.
    if (resultado.success || resultado.status === 'denegado') {
      resultado.xml = buildNfeProcEnvelope(signedXml, resultado, tpAmb);
    }

    delete resultado.protNFeXml;
    return resultado;
  } catch (error: any) {
    // A chave da contingência é fixa (está no XML): reenviar o mesmo XML é seguro.
    const idMatch = signedXml.match(/Id="NFe(\d{44})"/);
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro desconhecido ao transmitir NFC-e em contingência',
      erros: [error.message],
      chaveAcesso: idMatch ? idMatch[1] : undefined,
      ...(naoChegouASefaz(error) ? { naoEnviado: true } : {}),
    };
  }
}

/**
 * Consulta o protocolo de uma NFe/NFCe pela chave de acesso
 */
export async function consultarProtocolo(request: NFeConsultaRequest): Promise<SefazResponse> {
  try {
    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';

    const soapBody =
      `<nfeDadosMsg xmlns="${CONSULTA_NS}">` +
      `<consSitNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<xServ>CONSULTAR</xServ>` +
      `<chNFe>${request.chaveAcesso}</chNFe>` +
      `</consSitNFe>` +
      `</nfeDadosMsg>`;

    // Determinar modelo pela posição 20-21 da chave (55=NFe, 65=NFCe)
    const modelo = request.chaveAcesso.substring(20, 22);
    const endpoints = modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.consultaProtocolo,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    const ret = retorno['retConsSitNFe'] || retorno;

    const cStat = String(ret['cStat'] || '');
    const xMotivo = String(ret['xMotivo'] || '');

    // Verificar protocolo
    const protNFe = ret['protNFe'];
    if (protNFe) {
      const infProt = protNFe['infProt'] || protNFe;
      const protStat = String(infProt['cStat'] || cStat);
      // Nota cancelada: o protNFe ainda é o da autorização (cStat 100) — o desfecho é o
      // cStat da consulta (101/151/155), e o XML do cancelamento vem nos eventos.
      const cancelada = CANCELADA.includes(cStat);
      const resultado: SefazResponse = cancelada
        ? {
            success: false,
            status: 'cancelado',
            codigoStatus: cStat,
            motivoStatus: xMotivo,
            chaveAcesso: request.chaveAcesso,
            protocolo: String(infProt['nProt'] || ''),
            dataRecebimento: String(infProt['dhRecbto'] || ''),
            xmlCancelamento: extrairProcCancelamento(soapResponse),
          }
        : {
            success: protStat === '100' || protStat === '150',
            status: interpretarStatus(protStat),
            codigoStatus: protStat,
            motivoStatus: String(infProt['xMotivo'] || xMotivo),
            chaveAcesso: request.chaveAcesso,
            protocolo: String(infProt['nProt'] || ''),
            dataRecebimento: String(infProt['dhRecbto'] || ''),
          };
      if (request.xmlAssinado) {
        const xml = nfeProcDaConsulta(request.xmlAssinado, request.chaveAcesso, soapResponse, tpAmb);
        if (xml) resultado.xml = xml;
      }
      return resultado;
    }

    return {
      success: false,
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso: request.chaveAcesso,
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao consultar protocolo',
      erros: [error.message],
    };
  }
}

/**
 * Cancela uma NFe/NFCe
 * Evento tipo 110111
 */
export async function cancelarNFe(request: NFeCancelarRequest): Promise<SefazResponse> {
  try {
    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';

    const chave = request.chaveAcesso;
    const cUF = chave.substring(0, 2);
    const cnpj = chave.substring(6, 20);
    const tpEvento = '110111';
    const nSeqEvento = '1';
    const idEvento = `ID${tpEvento}${chave}${nSeqEvento.padStart(2, '0')}`;
    const dhEvento = formatarDataSefaz(undefined, request.ufEmitente);
    const loteId = gerarIdLote();

    const eventoXml =
      `<envEvento xmlns="${SEFAZ_NS}" versao="1.00">` +
      `<idLote>${loteId}</idLote>` +
      `<evento versao="1.00">` +
      `<infEvento Id="${idEvento}">` +
      `<cOrgao>${cUF}</cOrgao>` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<CNPJ>${cnpj}</CNPJ>` +
      `<chNFe>${chave}</chNFe>` +
      `<dhEvento>${dhEvento}</dhEvento>` +
      `<tpEvento>${tpEvento}</tpEvento>` +
      `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00">` +
      `<descEvento>Cancelamento</descEvento>` +
      `<nProt>${request.protocolo}</nProt>` +
      `<xJust>${escapeXml(request.justificativa)}</xJust>` +
      `</detEvento>` +
      `</infEvento>` +
      `</evento>` +
      `</envEvento>`;

    // Assinar o evento
    const signedXml = assinarEvento(eventoXml, request.certificado);

    // Envelopar para SOAP
    const soapBody =
      `<nfeDadosMsg xmlns="${RECEPCAO_EVENTO_NS}">` +
      signedXml +
      `</nfeDadosMsg>`;

    // Determinar modelo pela posição 20-21 da chave
    const modelo = chave.substring(20, 22);
    const endpoints = modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.recepcaoEvento,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    return comProcEvento(parseRetEvento(retorno, chave), signedXml, soapResponse);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao cancelar NFe',
      erros: [error.message],
    };
  }
}

/**
 * Emite Carta de Correção (CCe) para uma NFe
 * Evento tipo 110110
 */
export async function cartaCorrecao(request: NFeCartaCorrecaoRequest): Promise<SefazResponse> {
  try {
    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';

    const chave = request.chaveAcesso;
    const cUF = chave.substring(0, 2);
    const cnpj = chave.substring(6, 20);
    const tpEvento = '110110';
    const nSeqEvento = String(request.sequencia || 1);
    const idEvento = `ID${tpEvento}${chave}${nSeqEvento.padStart(2, '0')}`;
    const dhEvento = formatarDataSefaz(undefined, request.ufEmitente);
    const loteId = gerarIdLote();

    const xCondUso =
      'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, ' +
      'de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de ' +
      'documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o ' +
      'valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da ' +
      'operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ' +
      'ou do destinatario; III - a data de emissao ou de saida.';

    const eventoXml =
      `<envEvento xmlns="${SEFAZ_NS}" versao="1.00">` +
      `<idLote>${loteId}</idLote>` +
      `<evento versao="1.00">` +
      `<infEvento Id="${idEvento}">` +
      `<cOrgao>${cUF}</cOrgao>` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<CNPJ>${cnpj}</CNPJ>` +
      `<chNFe>${chave}</chNFe>` +
      `<dhEvento>${dhEvento}</dhEvento>` +
      `<tpEvento>${tpEvento}</tpEvento>` +
      `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
      `<verEvento>1.00</verEvento>` +
      `<detEvento versao="1.00">` +
      `<descEvento>Carta de Correcao</descEvento>` +
      `<xCorrecao>${escapeXml(request.correcao)}</xCorrecao>` +
      `<xCondUso>${xCondUso}</xCondUso>` +
      `</detEvento>` +
      `</infEvento>` +
      `</evento>` +
      `</envEvento>`;

    // Assinar o evento
    const signedXml = assinarEvento(eventoXml, request.certificado);

    // Envelopar para SOAP
    const soapBody =
      `<nfeDadosMsg xmlns="${RECEPCAO_EVENTO_NS}">` +
      signedXml +
      `</nfeDadosMsg>`;

    const endpoints = getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.recepcaoEvento,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    return comProcEvento(parseRetEvento(retorno, chave), signedXml, soapResponse);
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao emitir carta de correção',
      erros: [error.message],
    };
  }
}

/**
 * Normaliza o ano da inutilização para 2 dígitos (formato do leiaute:
 * <ano> e Id usam AA). Aceita "26" ou "2026"; qualquer outra coisa é erro
 * claro — ano errado no Id quebra a validação de 43 dígitos na SEFAZ.
 * Exportada para testes unitários (pura).
 */
export function normalizarAnoInutilizacao(ano: string | number): string {
  const raw = String(ano).trim();
  const normalizado = /^\d{4}$/.test(raw) ? raw.slice(2) : raw;
  if (!/^\d{2}$/.test(normalizado)) {
    throw new Error(`Ano inválido para inutilização: "${ano}". Use 2 dígitos ("26") ou 4 dígitos ("2026").`);
  }
  return normalizado;
}

/**
 * Inutiliza uma faixa de numeração de NFe/NFCe
 */
export async function inutilizar(request: NFeInutilizarRequest): Promise<SefazResponse> {
  try {
    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';

    const cUF = UF_CODES[request.ufEmitente.toUpperCase()];
    if (!cUF) {
      throw new Error(`UF inválida: ${request.ufEmitente}`);
    }

    const cnpj = apenasNumeros(request.cnpj);
    const serie = request.serie.padStart(3, '0');
    const nNFIni = String(request.numeroInicial).padStart(9, '0');
    const nNFFin = String(request.numeroFinal).padStart(9, '0');
    const ano = normalizarAnoInutilizacao(request.ano);

    // ID: ID + cUF(2) + ano(2) + CNPJ(14) + mod(2) + serie(3) + nNFIni(9) + nNFFin(9) = 43 dígitos
    const idInut = `ID${cUF}${ano}${cnpj}${request.modelo}${serie}${nNFIni}${nNFFin}`;

    const inutXml =
      `<inutNFe xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<infInut Id="${idInut}">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<xServ>INUTILIZAR</xServ>` +
      `<cUF>${cUF}</cUF>` +
      `<ano>${ano}</ano>` +
      `<CNPJ>${cnpj}</CNPJ>` +
      `<mod>${request.modelo}</mod>` +
      `<serie>${request.serie}</serie>` +
      `<nNFIni>${String(request.numeroInicial)}</nNFIni>` +
      `<nNFFin>${String(request.numeroFinal)}</nNFFin>` +
      `<xJust>${escapeXml(request.justificativa)}</xJust>` +
      `</infInut>` +
      `</inutNFe>`;

    // Assinar
    const signedXml = assinarInutilizacao(inutXml, request.certificado);

    // Envelopar para SOAP
    const soapBody =
      `<nfeDadosMsg xmlns="${INUTILIZACAO_NS}">` +
      signedXml +
      `</nfeDadosMsg>`;

    const endpoints = request.modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.inutilizacao,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4/nfeInutilizacaoNF',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    const ret = retorno['retInutNFe'] || retorno;
    const infInut = ret['infInut'] || ret;

    const cStat = String(infInut['cStat'] || '');
    const xMotivo = String(infInut['xMotivo'] || '');

    const resultado: SefazResponse = {
      success: cStat === '102',
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      protocolo: String(infInut['nProt'] || ''),
      dataRecebimento: String(infInut['dhRecbto'] || ''),
    };
    if (resultado.success) {
      resultado.xml = montarProcInutNFe(signedXml, soapResponse);
    }
    return resultado;
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao inutilizar numeração',
      erros: [error.message],
    };
  }
}

/**
 * Consulta o status do serviço SEFAZ
 */
export async function statusServico(request: StatusServicoRequest): Promise<SefazResponse> {
  try {
    const ambiente = request.ambiente || config.sefazAmbiente;
    const tpAmb: '1' | '2' = ambiente === 'producao' ? '1' : '2';

    const cUF = UF_CODES[request.ufEmitente.toUpperCase()];
    if (!cUF) {
      throw new Error(`UF inválida: ${request.ufEmitente}`);
    }

    const soapBody =
      `<nfeDadosMsg xmlns="${STATUS_NS}">` +
      `<consStatServ xmlns="${SEFAZ_NS}" versao="4.00">` +
      `<tpAmb>${tpAmb}</tpAmb>` +
      `<cUF>${cUF}</cUF>` +
      `<xServ>STATUS</xServ>` +
      `</consStatServ>` +
      `</nfeDadosMsg>`;

    const modelo = request.modelo || '55';
    const endpoints = modelo === '65'
      ? getNFCeEndpoints(request.ufEmitente, ambiente)
      : getNFeEndpoints(request.ufEmitente, ambiente);

    const soapResponse = await enviarSoap(
      endpoints.statusServico,
      'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
      soapBody,
      request.certificado,
    );

    const retorno = extrairRetorno(soapResponse);
    const ret = retorno['retConsStatServ'] || retorno;

    const cStat = String(ret['cStat'] || '');
    const xMotivo = String(ret['xMotivo'] || '');

    return {
      success: cStat === '107',
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      dataRecebimento: String(ret['dhRecbto'] || ''),
    };
  } catch (error: any) {
    return {
      success: false,
      status: 'erro',
      codigoStatus: 'ERR',
      motivoStatus: error.message || 'Erro ao consultar status do serviço',
      erros: [error.message],
    };
  }
}

// ============================================================
// Helpers de parsing de retorno de evento
// ============================================================

/** O evento registrado ganha o procEventoNFe em `xml`. */
function comProcEvento(resultado: SefazResponse, envEventoAssinado: string, soapXml: string): SefazResponse {
  if (resultado.success) {
    resultado.xml = montarProcEventoNFe(envEventoAssinado, soapXml);
  }
  return resultado;
}

/**
 * Parseia o retorno de um evento (cancelamento, CCe).
 * Exportada para testes unitários (pura, sem I/O).
 */
export function parseRetEvento(retorno: any, chaveAcesso: string): SefazResponse {
  const ret = retorno['retEnvEvento'] || retorno;

  const cStatLote = String(ret['cStat'] || '');

  // Verificar retorno individual do evento
  const retEvento = ret['retEvento'];
  if (retEvento) {
    const infEvento = retEvento['infEvento'] || retEvento;
    const cStat = String(infEvento['cStat'] || cStatLote);
    const xMotivo = String(infEvento['xMotivo'] || '');

    return {
      // 155 = cancelamento homologado FORA DE PRAZO: o evento foi registrado
      // (sucesso); a ressalva fica preservada em motivoStatus/codigoStatus.
      success: cStat === '135' || cStat === '136' || cStat === '101' || cStat === '155',
      status: interpretarStatus(cStat),
      codigoStatus: cStat,
      motivoStatus: xMotivo,
      chaveAcesso,
      protocolo: String(infEvento['nProt'] || ''),
      dataRecebimento: String(infEvento['dhRegEvento'] || ''),
    };
  }

  const xMotivo = String(ret['xMotivo'] || '');

  return {
    success: false,
    status: interpretarStatus(cStatLote),
    codigoStatus: cStatLote,
    motivoStatus: xMotivo,
    chaveAcesso,
    erros: [xMotivo],
  };
}
