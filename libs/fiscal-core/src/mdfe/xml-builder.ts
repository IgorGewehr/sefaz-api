// ============================================================
// MDF-e XML BUILDER - SEFAZ MDF-e v3.00
// Constrói XML do MDF-e e seus eventos conforme especificação
// ============================================================

import { create } from 'xmlbuilder2';
import type {
  MdfeRequest,
  MdfeDescarga,
  MdfeVeiculo,
  MdfeCondutor,
  MdfeSeguro,
  CertificateData,
} from '../types';
import { UF_CODES } from '../util/access-key';
import { formatarDataSefaz, formatarData, formatarValor } from '../util/datetime';
import { apenasNumeros } from '../util/cnpj';

const MDFE_NS = 'http://www.portalfiscal.inf.br/mdfe';

// ============================================================
// MDF-e Principal
// ============================================================

/**
 * Constrói o XML do MDF-e para envio ao SEFAZ.
 *
 * @param request - Dados do MDF-e
 * @param chaveAcesso - Chave de acesso de 44 dígitos já calculada
 * @param numero - Número do MDF-e
 * @param tpAmb - Tipo de ambiente: '1' (Produção) ou '2' (Homologação)
 * @returns XML string do MDF-e (sem assinatura)
 */
export function buildMdfeXml(
  request: MdfeRequest,
  chaveAcesso: string,
  numero: number,
  tpAmb: '1' | '2',
): string {
  const cUF = UF_CODES[request.ufInicio.toUpperCase()];
  if (!cUF) {
    throw new Error(`UF de início inválida: ${request.ufInicio}`);
  }

  // Extrair componentes da chave de acesso
  const cMDF = chaveAcesso.substring(35, 43); // código numérico (8 dígitos)
  const cDV = chaveAcesso.substring(43, 44); // dígito verificador

  const dataEmissao = formatarDataSefaz(undefined, request.ufInicio);
  const cnpj = apenasNumeros(request.emitente.cnpj);
  const serie = request.serie || '1';

  // Contar total de NFe em todas as descargas
  const totalNFe = request.descargas.reduce((acc, d) => acc + d.chaves.length, 0);

  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  const mdfe = doc.ele(MDFE_NS, 'MDFe');

  const infMDFe = mdfe.ele(MDFE_NS, 'infMDFe')
    .att('versao', '3.00')
    .att('Id', `MDFe${chaveAcesso}`);

  // --- <ide> ---
  const ide = infMDFe.ele(MDFE_NS, 'ide');
  ide.ele(MDFE_NS, 'cUF').txt(cUF);
  ide.ele(MDFE_NS, 'tpAmb').txt(tpAmb);
  const tpEmit = request.tpEmit || '2';
  ide.ele(MDFE_NS, 'tpEmit').txt(tpEmit);
  // tpTransp só é válido quando tpEmit = 1 (prestador de serviço de transporte)
  if (tpEmit === '1') {
    ide.ele(MDFE_NS, 'tpTransp').txt(request.tpTransp || '1');
  }
  ide.ele(MDFE_NS, 'mod').txt('58');
  ide.ele(MDFE_NS, 'serie').txt(serie);
  ide.ele(MDFE_NS, 'nMDF').txt(String(numero));
  ide.ele(MDFE_NS, 'cMDF').txt(cMDF);
  ide.ele(MDFE_NS, 'cDV').txt(cDV);
  ide.ele(MDFE_NS, 'modal').txt('1'); // 1 = Rodoviário
  ide.ele(MDFE_NS, 'dhEmi').txt(dataEmissao);
  ide.ele(MDFE_NS, 'tpEmis').txt('1'); // 1 = Normal
  ide.ele(MDFE_NS, 'procEmi').txt('0'); // 0 = Aplicativo do contribuinte
  ide.ele(MDFE_NS, 'verProc').txt('1.0');
  ide.ele(MDFE_NS, 'UFIni').txt(request.ufInicio.toUpperCase());
  ide.ele(MDFE_NS, 'UFFim').txt(request.ufFim.toUpperCase());

  // Municípios de carregamento
  for (const mun of request.municipiosCarregamento) {
    const infMunCarrega = ide.ele(MDFE_NS, 'infMunCarrega');
    infMunCarrega.ele(MDFE_NS, 'cMunCarrega').txt(mun.codigoMunicipio);
    infMunCarrega.ele(MDFE_NS, 'xMunCarrega').txt(mun.nome);
  }

  // Percurso (UFs intermediárias, opcional)
  if (request.percurso && request.percurso.length > 0) {
    for (const ufPer of request.percurso) {
      const infPercurso = ide.ele(MDFE_NS, 'infPercurso');
      infPercurso.ele(MDFE_NS, 'UFPer').txt(ufPer.toUpperCase());
    }
  }

  // --- <emit> ---
  const emit = infMDFe.ele(MDFE_NS, 'emit');
  emit.ele(MDFE_NS, 'CNPJ').txt(cnpj);
  emit.ele(MDFE_NS, 'IE').txt(apenasNumeros(request.emitente.inscricaoEstadual));
  emit.ele(MDFE_NS, 'xNome').txt(request.emitente.nome);
  if (request.emitente.nomeFantasia) {
    emit.ele(MDFE_NS, 'xFant').txt(request.emitente.nomeFantasia);
  }

  const enderEmit = emit.ele(MDFE_NS, 'enderEmit');
  enderEmit.ele(MDFE_NS, 'xLgr').txt(request.emitente.endereco.logradouro);
  enderEmit.ele(MDFE_NS, 'nro').txt(request.emitente.endereco.numero);
  if (request.emitente.endereco.complemento) {
    enderEmit.ele(MDFE_NS, 'xCpl').txt(request.emitente.endereco.complemento);
  }
  enderEmit.ele(MDFE_NS, 'xBairro').txt(request.emitente.endereco.bairro);
  enderEmit.ele(MDFE_NS, 'cMun').txt(request.emitente.endereco.codigoMunicipio);
  enderEmit.ele(MDFE_NS, 'xMun').txt(request.emitente.endereco.municipio);
  enderEmit.ele(MDFE_NS, 'CEP').txt(apenasNumeros(request.emitente.endereco.cep));
  enderEmit.ele(MDFE_NS, 'UF').txt(request.emitente.endereco.uf.toUpperCase());
  if (request.emitente.endereco.telefone) {
    enderEmit.ele(MDFE_NS, 'fone').txt(apenasNumeros(request.emitente.endereco.telefone));
  }

  // --- <infModal> ---
  const infModal = infMDFe.ele(MDFE_NS, 'infModal').att('versaoModal', '3.00');

  const rodo = infModal.ele(MDFE_NS, 'rodo');

  // infANTT (RNTRC do veículo de tração ou reboques)
  const rntrc = request.veiculo.rntrc;
  if (rntrc) {
    const infANTT = rodo.ele(MDFE_NS, 'infANTT');
    infANTT.ele(MDFE_NS, 'RNTRC').txt(rntrc);
  }

  // Veículo de tração
  buildVeiculoTracao(rodo, request.veiculo, request.condutores);

  // Veículos reboque (opcional)
  if (request.reboques && request.reboques.length > 0) {
    for (const reboque of request.reboques) {
      buildVeiculoReboque(rodo, reboque);
    }
  }

  // --- <infDoc> ---
  const infDoc = infMDFe.ele(MDFE_NS, 'infDoc');

  for (const descarga of request.descargas) {
    const infMunDescarga = infDoc.ele(MDFE_NS, 'infMunDescarga');
    infMunDescarga.ele(MDFE_NS, 'cMunDescarga').txt(descarga.codigoMunicipio);
    infMunDescarga.ele(MDFE_NS, 'xMunDescarga').txt(descarga.nomeMunicipio);

    for (const chave of descarga.chaves) {
      const infNFe = infMunDescarga.ele(MDFE_NS, 'infNFe');
      infNFe.ele(MDFE_NS, 'chNFe').txt(chave);
    }
  }

  // --- <seg> (opcional) ---
  if (request.seguro) {
    buildSeguro(infMDFe, request.seguro);
  }

  // --- <prodPred> (produto predominante - obrigatório) ---
  const prodPred = infMDFe.ele(MDFE_NS, 'prodPred');
  prodPred.ele(MDFE_NS, 'tpCarga').txt(request.produtoPredominante.tipoCarga);
  prodPred.ele(MDFE_NS, 'xProd').txt(request.produtoPredominante.descricao);
  if (request.produtoPredominante.cean) {
    prodPred.ele(MDFE_NS, 'cEAN').txt(request.produtoPredominante.cean);
  }
  if (request.produtoPredominante.ncm) {
    prodPred.ele(MDFE_NS, 'NCM').txt(request.produtoPredominante.ncm);
  }

  // --- <tot> ---
  const tot = infMDFe.ele(MDFE_NS, 'tot');
  tot.ele(MDFE_NS, 'qNFe').txt(String(totalNFe));
  tot.ele(MDFE_NS, 'vCarga').txt(formatarValor(request.valorTotalCarga));
  tot.ele(MDFE_NS, 'cUnid').txt(request.codigoUnidadePeso); // 01=KG, 02=TON
  tot.ele(MDFE_NS, 'qCarga').txt(formatarValor(request.pesoBrutoTotal, 4));

  // --- Informações adicionais (opcionais, dentro de <infAdic>) ---
  if (request.informacoesFisco || request.informacoesAdicionais) {
    const infAdic = infMDFe.ele(MDFE_NS, 'infAdic');
    if (request.informacoesFisco) {
      infAdic.ele(MDFE_NS, 'infAdFisco').txt(request.informacoesFisco);
    }
    if (request.informacoesAdicionais) {
      infAdic.ele(MDFE_NS, 'infCpl').txt(request.informacoesAdicionais);
    }
  }

  return doc.end({ prettyPrint: false });
}

/**
 * Constrói o nó <veicTracao> dentro de <rodo>
 */
function buildVeiculoTracao(
  rodo: any,
  veiculo: MdfeVeiculo,
  condutores: MdfeCondutor[],
): void {
  const veicTracao = rodo.ele(MDFE_NS, 'veicTracao');
  veicTracao.ele(MDFE_NS, 'placa').txt(veiculo.placa.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (veiculo.renavam) {
    veicTracao.ele(MDFE_NS, 'RENAVAM').txt(veiculo.renavam);
  }
  veicTracao.ele(MDFE_NS, 'tara').txt(String(veiculo.tara));
  if (veiculo.capKG) {
    veicTracao.ele(MDFE_NS, 'capKG').txt(String(veiculo.capKG));
  }
  if (veiculo.capM3) {
    veicTracao.ele(MDFE_NS, 'capM3').txt(String(veiculo.capM3));
  }
  // Condutores (pelo menos 1 obrigatório — deve vir ANTES de tpRod per XSD)
  for (const condutor of condutores) {
    const condutorEle = veicTracao.ele(MDFE_NS, 'condutor');
    condutorEle.ele(MDFE_NS, 'xNome').txt(condutor.nome);
    condutorEle.ele(MDFE_NS, 'CPF').txt(apenasNumeros(condutor.cpf));
  }

  veicTracao.ele(MDFE_NS, 'tpRod').txt(veiculo.tipoRodado);
  veicTracao.ele(MDFE_NS, 'tpCar').txt(veiculo.tipoCarroceria);
  veicTracao.ele(MDFE_NS, 'UF').txt(veiculo.uf.toUpperCase());
}

/**
 * Constrói o nó <veicReboque> dentro de <rodo>
 */
function buildVeiculoReboque(rodo: any, reboque: MdfeVeiculo): void {
  const veicReboque = rodo.ele(MDFE_NS, 'veicReboque');
  veicReboque.ele(MDFE_NS, 'placa').txt(reboque.placa.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (reboque.renavam) {
    veicReboque.ele(MDFE_NS, 'RENAVAM').txt(reboque.renavam);
  }
  veicReboque.ele(MDFE_NS, 'tara').txt(String(reboque.tara));
  if (reboque.capKG) {
    veicReboque.ele(MDFE_NS, 'capKG').txt(String(reboque.capKG));
  }
  if (reboque.capM3) {
    veicReboque.ele(MDFE_NS, 'capM3').txt(String(reboque.capM3));
  }
  veicReboque.ele(MDFE_NS, 'tpRod').txt(reboque.tipoRodado);
  veicReboque.ele(MDFE_NS, 'tpCar').txt(reboque.tipoCarroceria);
  veicReboque.ele(MDFE_NS, 'UF').txt(reboque.uf.toUpperCase());
}

/**
 * Constrói o nó <seg> dentro de <infMDFe>
 */
function buildSeguro(infMDFe: any, seguro: MdfeSeguro): void {
  const seg = infMDFe.ele(MDFE_NS, 'seg');

  const infResp = seg.ele(MDFE_NS, 'infResp');
  infResp.ele(MDFE_NS, 'respSeg').txt(seguro.responsavel);
  if (seguro.cnpjResponsavel) {
    infResp.ele(MDFE_NS, 'CNPJ').txt(apenasNumeros(seguro.cnpjResponsavel));
  }

  if (seguro.nomeSeguradora || seguro.numeroApolice) {
    const infSeg = seg.ele(MDFE_NS, 'infSeg');
    if (seguro.nomeSeguradora) {
      infSeg.ele(MDFE_NS, 'xSeg').txt(seguro.nomeSeguradora);
    }
    if (seguro.numeroApolice) {
      infSeg.ele(MDFE_NS, 'nApol').txt(seguro.numeroApolice);
    }
  }

  if (seguro.numeroAverbacao && seguro.numeroAverbacao.length > 0) {
    for (const aver of seguro.numeroAverbacao) {
      seg.ele(MDFE_NS, 'nAver').txt(aver);
    }
  }
}

// ============================================================
// Eventos MDF-e
// ============================================================

interface EventoBaseParams {
  chaveAcesso: string;
  cnpj: string;
  tpAmb: '1' | '2';
  nSeqEvento?: number;
}

/**
 * Constrói envelope base de evento MDF-e.
 * Retorna o nó <detEvento> para que cada evento adicione seu conteúdo específico.
 */
function buildEventoBase(
  tpEvento: string,
  params: EventoBaseParams,
): { doc: any; detEvento: any } {
  const { chaveAcesso, cnpj, tpAmb, nSeqEvento = 1 } = params;

  // cOrgao = código UF extraído da chave de acesso (2 primeiros dígitos)
  const cOrgao = chaveAcesso.substring(0, 2);
  const seqFormatted = String(nSeqEvento).padStart(2, '0');

  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  const eventoMDFe = doc.ele(MDFE_NS, 'eventoMDFe').att('versao', '3.00');

  const infEvento = eventoMDFe.ele(MDFE_NS, 'infEvento')
    .att('Id', `ID${tpEvento}${chaveAcesso}${seqFormatted}`);

  infEvento.ele(MDFE_NS, 'cOrgao').txt(cOrgao);
  infEvento.ele(MDFE_NS, 'tpAmb').txt(tpAmb);
  infEvento.ele(MDFE_NS, 'CNPJ').txt(apenasNumeros(cnpj));
  infEvento.ele(MDFE_NS, 'chMDFe').txt(chaveAcesso);
  infEvento.ele(MDFE_NS, 'dhEvento').txt(formatarDataSefaz());
  infEvento.ele(MDFE_NS, 'tpEvento').txt(tpEvento);
  infEvento.ele(MDFE_NS, 'nSeqEvento').txt(String(nSeqEvento));

  const detEvento = infEvento.ele(MDFE_NS, 'detEvento').att('versaoEvento', '3.00');

  return { doc, detEvento };
}

/**
 * Evento de Encerramento do MDF-e (tpEvento = 110112)
 */
export function buildMdfeEventoEncerramento(params: {
  chaveAcesso: string;
  cnpj: string;
  protocolo: string;
  codigoMunicipio: string;
  uf: string;
  dataEncerramento?: string; // YYYY-MM-DD
  tpAmb: '1' | '2';
  nSeqEvento?: number;
}): string {
  const { doc, detEvento } = buildEventoBase('110112', {
    chaveAcesso: params.chaveAcesso,
    cnpj: params.cnpj,
    tpAmb: params.tpAmb,
    nSeqEvento: params.nSeqEvento,
  });

  const cUF = UF_CODES[params.uf.toUpperCase()];
  if (!cUF) {
    throw new Error(`UF inválida para encerramento: ${params.uf}`);
  }

  const evEncMDFe = detEvento.ele(MDFE_NS, 'evEncMDFe');
  evEncMDFe.ele(MDFE_NS, 'descEvento').txt('Encerramento');
  evEncMDFe.ele(MDFE_NS, 'nProt').txt(params.protocolo);
  evEncMDFe.ele(MDFE_NS, 'dtEnc').txt(params.dataEncerramento || formatarData());
  evEncMDFe.ele(MDFE_NS, 'cUF').txt(cUF);
  evEncMDFe.ele(MDFE_NS, 'cMun').txt(params.codigoMunicipio);

  return doc.end({ prettyPrint: false });
}

/**
 * Evento de Cancelamento do MDF-e (tpEvento = 110111)
 */
export function buildMdfeEventoCancelamento(params: {
  chaveAcesso: string;
  cnpj: string;
  protocolo: string;
  justificativa: string;
  tpAmb: '1' | '2';
  nSeqEvento?: number;
}): string {
  const { doc, detEvento } = buildEventoBase('110111', {
    chaveAcesso: params.chaveAcesso,
    cnpj: params.cnpj,
    tpAmb: params.tpAmb,
    nSeqEvento: params.nSeqEvento,
  });

  const evCancMDFe = detEvento.ele(MDFE_NS, 'evCancMDFe');
  evCancMDFe.ele(MDFE_NS, 'descEvento').txt('Cancelamento');
  evCancMDFe.ele(MDFE_NS, 'nProt').txt(params.protocolo);
  evCancMDFe.ele(MDFE_NS, 'xJust').txt(params.justificativa);

  return doc.end({ prettyPrint: false });
}

/**
 * Evento de Inclusão de Condutor (tpEvento = 110114)
 */
export function buildMdfeEventoInclusaoCondutor(params: {
  chaveAcesso: string;
  cnpj: string;
  nomeCondutor: string;
  cpfCondutor: string;
  tpAmb: '1' | '2';
  nSeqEvento?: number;
}): string {
  const { doc, detEvento } = buildEventoBase('110114', {
    chaveAcesso: params.chaveAcesso,
    cnpj: params.cnpj,
    tpAmb: params.tpAmb,
    nSeqEvento: params.nSeqEvento,
  });

  const evIncCondutorMDFe = detEvento.ele(MDFE_NS, 'evIncCondutorMDFe');
  evIncCondutorMDFe.ele(MDFE_NS, 'descEvento').txt('Inclusao Condutor');
  const condutor = evIncCondutorMDFe.ele(MDFE_NS, 'condutor');
  condutor.ele(MDFE_NS, 'xNome').txt(params.nomeCondutor);
  condutor.ele(MDFE_NS, 'CPF').txt(apenasNumeros(params.cpfCondutor));

  return doc.end({ prettyPrint: false });
}

/**
 * Evento de Inclusão de DF-e (tpEvento = 110115)
 */
export function buildMdfeEventoInclusaoDFe(params: {
  chaveAcesso: string;
  cnpj: string;
  codigoMunDescarga: string;
  nomeMunDescarga: string;
  chaveNFe: string;
  tpAmb: '1' | '2';
  nSeqEvento?: number;
}): string {
  const { doc, detEvento } = buildEventoBase('110115', {
    chaveAcesso: params.chaveAcesso,
    cnpj: params.cnpj,
    tpAmb: params.tpAmb,
    nSeqEvento: params.nSeqEvento,
  });

  const evIncDFeMDFe = detEvento.ele(MDFE_NS, 'evIncDFeMDFe');
  evIncDFeMDFe.ele(MDFE_NS, 'descEvento').txt('Inclusao DF-e');
  evIncDFeMDFe.ele(MDFE_NS, 'cMunDescarga').txt(params.codigoMunDescarga);
  evIncDFeMDFe.ele(MDFE_NS, 'xMunDescarga').txt(params.nomeMunDescarga);
  evIncDFeMDFe.ele(MDFE_NS, 'chNFe').txt(params.chaveNFe);

  return doc.end({ prettyPrint: false });
}
