// ============================================================
// NFS-e XML Builder - Padrão Nacional ABRASF 2.04
// Constrói XMLs para envio ao Ambiente de Dados Nacional
// ============================================================

import { create } from 'xmlbuilder2';
import type {
  NfseEmitirRequest,
  NfsePrestador,
  NfseTomador,
  NfseIntermediario,
  NfseServico,
  NfseValores,
  NfseRps,
  NfseConstrucaoCivil,
  NfseCancelarRequest,
  NfseConsultarLoteRequest,
  NfseConsultarNfseRequest,
} from '../../types/nfse';
import { apenasNumeros, formatarValor } from '../utils';

const NFSE_NS = 'http://www.abrasf.org.br/nfse.xsd';

// ============================================================
// EnviarLoteRps - Envio de lote de RPS
// ============================================================

/**
 * Gera o XML <EnviarLoteRpsEnvio> contendo um ou mais RPS.
 * Cada <InfDeclaracaoPrestacaoServico> será assinado individualmente
 * pelo service antes do envio.
 *
 * @param loteId - Identificador único do lote
 * @param cnpjPrestador - CNPJ do prestador
 * @param inscricaoMunicipal - IM do prestador
 * @param rpsList - Lista de RPS para envio
 * @returns XML string (sem assinatura — assinatura é feita pelo service)
 */
export function buildEnviarLoteRpsXml(
  loteId: string,
  cnpjPrestador: string,
  inscricaoMunicipal: string,
  rpsList: NfseEmitirRequest[],
): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  const envio = doc.ele(NFSE_NS, 'EnviarLoteRpsEnvio');

  const lote = envio.ele(NFSE_NS, 'LoteRps')
    .att('Id', `lote_${loteId}`)
    .att('versao', '2.04');

  lote.ele(NFSE_NS, 'NumeroLote').txt(loteId);
  lote.ele(NFSE_NS, 'CpfCnpj')
    .ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(cnpjPrestador));
  lote.ele(NFSE_NS, 'InscricaoMunicipal').txt(inscricaoMunicipal);
  lote.ele(NFSE_NS, 'QuantidadeRps').txt(String(rpsList.length));

  const listaRps = lote.ele(NFSE_NS, 'ListaRps');

  for (const rpsRequest of rpsList) {
    buildRpsElement(listaRps, rpsRequest);
  }

  return doc.end({ prettyPrint: false });
}

/**
 * Gera um único <Rps> dentro do <ListaRps>.
 * O Id na tag <InfDeclaracaoPrestacaoServico> é usado como referência
 * para a assinatura digital.
 */
function buildRpsElement(parent: any, request: NfseEmitirRequest): void {
  const rps = parent.ele(NFSE_NS, 'Rps');

  const rpsId = `rps_${request.rps.serie}_${request.rps.numero}`;
  const infDecl = rps.ele(NFSE_NS, 'InfDeclaracaoPrestacaoServico')
    .att('Id', rpsId);

  // --- <Rps> (identificação do RPS) ---
  buildIdentificacaoRps(infDecl, request.rps);

  // --- <Competencia> ---
  infDecl.ele(NFSE_NS, 'Competencia').txt(request.rps.dataEmissao);

  // --- <Servico> ---
  buildServico(infDecl, request.servico, request.valores);

  // --- <Prestador> ---
  buildPrestador(infDecl, request.prestador);

  // --- <Tomador> ---
  buildTomador(infDecl, request.tomador);

  // --- <Intermediario> (opcional) ---
  if (request.intermediario) {
    buildIntermediario(infDecl, request.intermediario);
  }

  // --- <ConstrucaoCivil> (opcional) ---
  if (request.construcaoCivil) {
    buildConstrucaoCivil(infDecl, request.construcaoCivil);
  }

  // --- Regime Especial ---
  if (request.prestador.regimeEspecialTributacao) {
    infDecl.ele(NFSE_NS, 'RegimeEspecialTributacao')
      .txt(request.prestador.regimeEspecialTributacao);
  }

  // --- Optante Simples ---
  infDecl.ele(NFSE_NS, 'OptanteSimplesNacional')
    .txt(request.prestador.optanteSimplesNacional ? '1' : '2');

  // --- Incentivador Cultural ---
  infDecl.ele(NFSE_NS, 'IncentivoFiscal')
    .txt(request.prestador.incentivadorCultural ? '1' : '2');

  // --- Informações Complementares ---
  if (request.informacoesComplementares) {
    infDecl.ele(NFSE_NS, 'InformacoesComplementares')
      .txt(request.informacoesComplementares);
  }
}

// ============================================================
// Blocos internos do RPS
// ============================================================

function buildIdentificacaoRps(parent: any, rps: NfseRps): void {
  const rpsNode = parent.ele(NFSE_NS, 'Rps');
  const ident = rpsNode.ele(NFSE_NS, 'IdentificacaoRps');
  ident.ele(NFSE_NS, 'Numero').txt(String(rps.numero));
  ident.ele(NFSE_NS, 'Serie').txt(rps.serie);
  ident.ele(NFSE_NS, 'Tipo').txt(rps.tipo);
  rpsNode.ele(NFSE_NS, 'DataEmissao').txt(rps.dataEmissao);
  rpsNode.ele(NFSE_NS, 'NaturezaOperacao').txt(rps.naturezaOperacao);
  rpsNode.ele(NFSE_NS, 'Status').txt('1'); // 1 = Normal
}

function buildServico(parent: any, servico: NfseServico, valores: NfseValores): void {
  const servicoNode = parent.ele(NFSE_NS, 'Servico');

  // --- Valores ---
  const valoresNode = servicoNode.ele(NFSE_NS, 'Valores');
  valoresNode.ele(NFSE_NS, 'ValorServicos').txt(formatarValor(valores.valorServicos));

  if (valores.valorDeducoes) {
    valoresNode.ele(NFSE_NS, 'ValorDeducoes').txt(formatarValor(valores.valorDeducoes));
  }
  if (valores.valorPis) {
    valoresNode.ele(NFSE_NS, 'ValorPis').txt(formatarValor(valores.valorPis));
  }
  if (valores.valorCofins) {
    valoresNode.ele(NFSE_NS, 'ValorCofins').txt(formatarValor(valores.valorCofins));
  }
  if (valores.valorInss) {
    valoresNode.ele(NFSE_NS, 'ValorInss').txt(formatarValor(valores.valorInss));
  }
  if (valores.valorIr) {
    valoresNode.ele(NFSE_NS, 'ValorIr').txt(formatarValor(valores.valorIr));
  }
  if (valores.valorCsll) {
    valoresNode.ele(NFSE_NS, 'ValorCsll').txt(formatarValor(valores.valorCsll));
  }
  if (valores.outrasRetencoes) {
    valoresNode.ele(NFSE_NS, 'OutrasRetencoes').txt(formatarValor(valores.outrasRetencoes));
  }
  if (valores.valorIssRetido) {
    valoresNode.ele(NFSE_NS, 'ValorIssRetido').txt(formatarValor(valores.valorIssRetido));
  }

  // Base de cálculo = Valor Serviços - Deduções - Desconto Incondicionado
  const baseCalculo = valores.valorServicos
    - (valores.valorDeducoes || 0)
    - (valores.descontoIncondicionado || 0);
  valoresNode.ele(NFSE_NS, 'BaseCalculo').txt(formatarValor(baseCalculo));

  // Alíquota ISS (formato decimal, ex: 0.05 = 5%)
  valoresNode.ele(NFSE_NS, 'Aliquota').txt(formatarValor(valores.aliquotaIss, 4));

  // Valor ISS calculado
  const valorIss = baseCalculo * valores.aliquotaIss;
  valoresNode.ele(NFSE_NS, 'ValorIss').txt(formatarValor(valorIss));

  // Valor líquido = Serviços - PIS - COFINS - INSS - IR - CSLL - Outras - ISS retido - Desc. Incond. - Desc. Cond.
  const valorLiquido = valores.valorServicos
    - (valores.valorPis || 0)
    - (valores.valorCofins || 0)
    - (valores.valorInss || 0)
    - (valores.valorIr || 0)
    - (valores.valorCsll || 0)
    - (valores.outrasRetencoes || 0)
    - (valores.issRetido ? (valores.valorIssRetido || 0) : 0)
    - (valores.descontoIncondicionado || 0)
    - (valores.descontoCondicionado || 0);
  valoresNode.ele(NFSE_NS, 'ValorLiquidoNfse').txt(formatarValor(valorLiquido));

  if (valores.descontoIncondicionado) {
    valoresNode.ele(NFSE_NS, 'DescontoIncondicionado')
      .txt(formatarValor(valores.descontoIncondicionado));
  }
  if (valores.descontoCondicionado) {
    valoresNode.ele(NFSE_NS, 'DescontoCondicionado')
      .txt(formatarValor(valores.descontoCondicionado));
  }

  // --- IssRetido ---
  servicoNode.ele(NFSE_NS, 'IssRetido').txt(valores.issRetido ? '1' : '2');

  // --- Código do serviço (Item Lista Serviço) ---
  servicoNode.ele(NFSE_NS, 'ItemListaServico').txt(servico.codigoServico);

  // --- Código de tributação nacional (cTribNac — Padrão Nacional ADN) ---
  if (servico.codigoTributacaoNacional) {
    servicoNode.ele(NFSE_NS, 'CodigoTributacaoNacional')
      .txt(servico.codigoTributacaoNacional);
  }

  // --- Código CNAE ---
  if (servico.cnae) {
    servicoNode.ele(NFSE_NS, 'CodigoCnae').txt(servico.cnae);
  }

  // --- Código de tributação municipal ---
  if (servico.codigoTributacaoMunicipio) {
    servicoNode.ele(NFSE_NS, 'CodigoTributacaoMunicipio')
      .txt(servico.codigoTributacaoMunicipio);
  }

  // --- Discriminação ---
  servicoNode.ele(NFSE_NS, 'Discriminacao').txt(servico.discriminacao);

  // --- Município de prestação ---
  servicoNode.ele(NFSE_NS, 'CodigoMunicipio').txt(servico.codigoMunicipioPrestacao);

  // --- Código do país (se exterior) ---
  if (servico.codigoPaisPrestacao && servico.codigoPaisPrestacao !== '1058') {
    servicoNode.ele(NFSE_NS, 'CodigoPais').txt(servico.codigoPaisPrestacao);
  }

  // --- Exigibilidade ISS ---
  servicoNode.ele(NFSE_NS, 'ExigibilidadeISS').txt(valores.exigibilidadeIss);

  // --- Município de incidência ---
  if (servico.codigoMunicipioIncidencia) {
    servicoNode.ele(NFSE_NS, 'MunicipioIncidencia').txt(servico.codigoMunicipioIncidencia);
  }

  // --- Número do processo (suspensão) ---
  if (valores.numeroProcesso) {
    servicoNode.ele(NFSE_NS, 'NumeroProcesso').txt(valores.numeroProcesso);
  }
}

function buildPrestador(parent: any, prestador: NfsePrestador): void {
  const prest = parent.ele(NFSE_NS, 'Prestador');
  const cpfCnpj = prest.ele(NFSE_NS, 'CpfCnpj');
  cpfCnpj.ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(prestador.cnpj));
  prest.ele(NFSE_NS, 'InscricaoMunicipal').txt(prestador.inscricaoMunicipal);
}

function buildTomador(parent: any, tomador: NfseTomador): void {
  const tomadorNode = parent.ele(NFSE_NS, 'Tomador');

  // IdentificacaoTomador
  if (tomador.cpf || tomador.cnpj) {
    const ident = tomadorNode.ele(NFSE_NS, 'IdentificacaoTomador');
    const cpfCnpj = ident.ele(NFSE_NS, 'CpfCnpj');
    if (tomador.cnpj) {
      cpfCnpj.ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(tomador.cnpj));
    } else if (tomador.cpf) {
      cpfCnpj.ele(NFSE_NS, 'Cpf').txt(apenasNumeros(tomador.cpf));
    }
    if (tomador.inscricaoMunicipal) {
      ident.ele(NFSE_NS, 'InscricaoMunicipal').txt(tomador.inscricaoMunicipal);
    }
  }

  // Razão Social
  tomadorNode.ele(NFSE_NS, 'RazaoSocial').txt(tomador.nome);

  // Endereço
  if (tomador.endereco) {
    const end = tomadorNode.ele(NFSE_NS, 'Endereco');
    end.ele(NFSE_NS, 'Endereco').txt(tomador.endereco.logradouro);
    end.ele(NFSE_NS, 'Numero').txt(tomador.endereco.numero);
    if (tomador.endereco.complemento) {
      end.ele(NFSE_NS, 'Complemento').txt(tomador.endereco.complemento);
    }
    end.ele(NFSE_NS, 'Bairro').txt(tomador.endereco.bairro);
    end.ele(NFSE_NS, 'CodigoMunicipio').txt(tomador.endereco.codigoMunicipio);
    end.ele(NFSE_NS, 'Uf').txt(tomador.endereco.uf.toUpperCase());
    end.ele(NFSE_NS, 'Cep').txt(apenasNumeros(tomador.endereco.cep));
  }

  // Contato
  if (tomador.contato) {
    const contato = tomadorNode.ele(NFSE_NS, 'Contato');
    if (tomador.contato.telefone) {
      contato.ele(NFSE_NS, 'Telefone').txt(apenasNumeros(tomador.contato.telefone));
    }
    if (tomador.contato.email) {
      contato.ele(NFSE_NS, 'Email').txt(tomador.contato.email);
    }
  }
}

function buildIntermediario(parent: any, intermediario: NfseIntermediario): void {
  const interNode = parent.ele(NFSE_NS, 'Intermediario');
  const ident = interNode.ele(NFSE_NS, 'IdentificacaoIntermediario');
  const cpfCnpj = ident.ele(NFSE_NS, 'CpfCnpj');

  if (intermediario.cnpj) {
    cpfCnpj.ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(intermediario.cnpj));
  } else if (intermediario.cpf) {
    cpfCnpj.ele(NFSE_NS, 'Cpf').txt(apenasNumeros(intermediario.cpf));
  }

  if (intermediario.inscricaoMunicipal) {
    ident.ele(NFSE_NS, 'InscricaoMunicipal').txt(intermediario.inscricaoMunicipal);
  }

  interNode.ele(NFSE_NS, 'RazaoSocial').txt(intermediario.nome);
}

function buildConstrucaoCivil(parent: any, cc: NfseConstrucaoCivil): void {
  const ccNode = parent.ele(NFSE_NS, 'ConstrucaoCivil');
  if (cc.codigoObra) {
    ccNode.ele(NFSE_NS, 'CodigoObra').txt(cc.codigoObra);
  }
  if (cc.art) {
    ccNode.ele(NFSE_NS, 'Art').txt(cc.art);
  }
}

// ============================================================
// ConsultarSituacaoLoteRps
// ============================================================

export function buildConsultarSituacaoLoteRpsXml(
  protocolo: string,
  cnpjPrestador: string,
  inscricaoMunicipal: string,
): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  const consulta = doc.ele(NFSE_NS, 'ConsultarSituacaoLoteRpsEnvio');
  const prest = consulta.ele(NFSE_NS, 'Prestador');
  prest.ele(NFSE_NS, 'CpfCnpj').ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(cnpjPrestador));
  prest.ele(NFSE_NS, 'InscricaoMunicipal').txt(inscricaoMunicipal);
  consulta.ele(NFSE_NS, 'Protocolo').txt(protocolo);

  return doc.end({ prettyPrint: false });
}

// ============================================================
// ConsultarLoteRps
// ============================================================

export function buildConsultarLoteRpsXml(request: NfseConsultarLoteRequest): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  const consulta = doc.ele(NFSE_NS, 'ConsultarLoteRpsEnvio');
  const prest = consulta.ele(NFSE_NS, 'Prestador');
  prest.ele(NFSE_NS, 'CpfCnpj').ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(request.prestador.cnpj));
  prest.ele(NFSE_NS, 'InscricaoMunicipal').txt(request.prestador.inscricaoMunicipal);
  consulta.ele(NFSE_NS, 'Protocolo').txt(request.protocolo);

  return doc.end({ prettyPrint: false });
}

// ============================================================
// ConsultarNfseServicoPrestado
// ============================================================

export function buildConsultarNfseXml(request: NfseConsultarNfseRequest): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  const consulta = doc.ele(NFSE_NS, 'ConsultarNfseServicoPrestadoEnvio');
  const prest = consulta.ele(NFSE_NS, 'Prestador');
  prest.ele(NFSE_NS, 'CpfCnpj').ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(request.prestador.cnpj));
  prest.ele(NFSE_NS, 'InscricaoMunicipal').txt(request.prestador.inscricaoMunicipal);

  if (request.numero) {
    consulta.ele(NFSE_NS, 'NumeroNfse').txt(String(request.numero));
  }

  if (request.dataInicial || request.dataFinal) {
    const periodo = consulta.ele(NFSE_NS, 'PeriodoEmissao');
    if (request.dataInicial) {
      periodo.ele(NFSE_NS, 'DataInicial').txt(request.dataInicial);
    }
    if (request.dataFinal) {
      periodo.ele(NFSE_NS, 'DataFinal').txt(request.dataFinal);
    }
  }

  if (request.tomador && (request.tomador.cpf || request.tomador.cnpj)) {
    const tomador = consulta.ele(NFSE_NS, 'Tomador');
    const cpfCnpj = tomador.ele(NFSE_NS, 'CpfCnpj');
    if (request.tomador.cnpj) {
      cpfCnpj.ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(request.tomador.cnpj));
    } else if (request.tomador.cpf) {
      cpfCnpj.ele(NFSE_NS, 'Cpf').txt(apenasNumeros(request.tomador.cpf));
    }
    if (request.tomador.inscricaoMunicipal) {
      tomador.ele(NFSE_NS, 'InscricaoMunicipal').txt(request.tomador.inscricaoMunicipal);
    }
  }

  return doc.end({ prettyPrint: false });
}

// ============================================================
// CancelarNfse
// ============================================================

export function buildCancelarNfseXml(request: NfseCancelarRequest): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' });

  const cancelar = doc.ele(NFSE_NS, 'CancelarNfseEnvio');
  const pedido = cancelar.ele(NFSE_NS, 'Pedido');
  const infPedido = pedido.ele(NFSE_NS, 'InfPedidoCancelamento')
    .att('Id', `cancel_${request.numero}`);

  const identNfse = infPedido.ele(NFSE_NS, 'IdentificacaoNfse');
  identNfse.ele(NFSE_NS, 'Numero').txt(String(request.numero));
  identNfse.ele(NFSE_NS, 'CpfCnpj')
    .ele(NFSE_NS, 'Cnpj').txt(apenasNumeros(request.prestador.cnpj));
  identNfse.ele(NFSE_NS, 'InscricaoMunicipal').txt(request.prestador.inscricaoMunicipal);
  identNfse.ele(NFSE_NS, 'CodigoMunicipio').txt(request.codigoMunicipio);

  infPedido.ele(NFSE_NS, 'CodigoCancelamento').txt(request.codigoCancelamento);

  return doc.end({ prettyPrint: false });
}
