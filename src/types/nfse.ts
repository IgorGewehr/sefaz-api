// ============================================================
// TIPOS - NFS-e Padrão Nacional (ABRASF 2.04 / ADN)
// ============================================================

import type { CertificateData } from './index';

// --- Prestador de Serviço ---

export interface NfsePrestador {
  cnpj: string;
  inscricaoMunicipal: string;
  nome: string;
  nomeFantasia?: string;
  endereco: NfseEndereco;
  contato?: NfseContato;
  /** Regime especial de tributação (legado ABRASF / Betha):
   * 1=Microempresa Municipal, 2=Estimativa, 3=Sociedade de Profissionais,
   * 4=Cooperativa, 5=MEI, 6=ME/EPP Simples Nacional */
  regimeEspecialTributacao?: '1' | '2' | '3' | '4' | '5' | '6';
  /** Optante Simples Nacional */
  optanteSimplesNacional: boolean;
  /** Incentivador cultural */
  incentivadorCultural?: boolean;

  // --- Campos ADN (DPS REST) ---

  /**
   * Regime de apuração de tributação do Simples Nacional (ADN):
   * 1=Receita bruta, 2=ME/EPP (Sublimites), 3=SIMEI, 4=Fixo
   */
  regApTribSN?: number;
  /**
   * Regime especial de tributação no ADN:
   * 0=Sem regime, 1=Cooperativa, 2=Estimativa,
   * 3=Microempresário Individual, 4=Notário/Registrador,
   * 5=Profissional Autônomo, 6=Nenhum
   */
  regEspTrib?: number;
}

// --- Tomador de Serviço ---

export interface NfseTomador {
  cpf?: string;
  cnpj?: string;
  inscricaoMunicipal?: string;
  nome: string;
  endereco?: NfseEndereco;
  contato?: NfseContato;
}

// --- Intermediário (opcional) ---

export interface NfseIntermediario {
  cpf?: string;
  cnpj?: string;
  inscricaoMunicipal?: string;
  nome: string;
}

// --- Endereço ---

export interface NfseEndereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigoMunicipio: string;
  uf: string;
  cep: string;
  codigoPais?: string; // Padrão '1058' = Brasil
}

// --- Contato ---

export interface NfseContato {
  telefone?: string;
  email?: string;
}

// --- Serviço Prestado ---

export interface NfseServico {
  /** Código de serviço conforme LC 116/2003 (ex: '01.01', '17.02') */
  codigoServico: string;
  /** Código CNAE (opcional, mas recomendado) */
  cnae?: string;
  /** Código de tributação nacional (cTribNac) — Padrão Nacional ADN (ex: '010700') */
  codigoTributacaoNacional?: string;
  /** Código de tributação do município (quando aplicável) */
  codigoTributacaoMunicipio?: string;
  /** Discriminação do serviço (descrição detalhada) */
  discriminacao: string;
  /** Município de prestação do serviço (código IBGE) */
  codigoMunicipioPrestacao: string;
  /** Município de incidência do ISS (código IBGE) */
  codigoMunicipioIncidencia?: string;
  /** Código do país de prestação (quando exterior) */
  codigoPaisPrestacao?: string;

  // --- Campos ADN (DPS REST) ---

  /** Código NBS (Nomenclatura Brasileira de Serviços) — obrigatório no ADN para exportação */
  nbs?: string;
  /**
   * Tipo de tributação do ISSQN no ADN:
   * 1=Isento, 2=Imune, 3=Não incidência, 4=Exportação,
   * 5=Tributação no município, 6=Tributação fora, 7=Fixo, 8=Regime especial
   */
  idTribMun?: string;
}

// --- Valores do Serviço ---

export interface NfseValores {
  /** Valor total dos serviços */
  valorServicos: number;
  /** Valor das deduções (base de cálculo reduzida) */
  valorDeducoes?: number;
  /** Valor do PIS */
  valorPis?: number;
  /** Valor da COFINS */
  valorCofins?: number;
  /** Valor do INSS */
  valorInss?: number;
  /** Valor do IR */
  valorIr?: number;
  /** Valor da CSLL */
  valorCsll?: number;
  /** Valor do ISS retido */
  valorIssRetido?: number;
  /** Valor de outras retenções */
  outrasRetencoes?: number;
  /** Desconto incondicionado */
  descontoIncondicionado?: number;
  /** Desconto condicionado */
  descontoCondicionado?: number;
  /** Alíquota ISS (ex: 0.05 = 5%) */
  aliquotaIss: number;
  /**
   * Exigibilidade do ISS:
   * 1=Exigível, 2=Não incidência, 3=Isenção, 4=Exportação,
   * 5=Imunidade, 6=Exigibilidade suspensa decisão judicial,
   * 7=Exigibilidade suspensa processo administrativo
   */
  exigibilidadeIss: '1' | '2' | '3' | '4' | '5' | '6' | '7';
  /** ISS retido? (true = tomador retém) */
  issRetido: boolean;
  /** Número do processo judicial/administrativo (quando exigibilidade 6 ou 7) */
  numeroProcesso?: string;
}

// --- RPS (Recibo Provisório de Serviço) ---

export interface NfseRps {
  /** Número do RPS */
  numero: number;
  /** Série do RPS */
  serie: string;
  /** Tipo do RPS: 1=RPS, 2=Nota Fiscal Conjugada, 3=Cupom */
  tipo: '1' | '2' | '3';
  /** Data de emissão do RPS (YYYY-MM-DD) */
  dataEmissao: string;
  /**
   * Natureza da operação:
   * 1=Tributação no município, 2=Tributação fora do município,
   * 3=Isenção, 4=Imune, 5=Exigibilidade suspensa decisão judicial,
   * 6=Exigibilidade suspensa processo administrativo
   */
  naturezaOperacao: '1' | '2' | '3' | '4' | '5' | '6';
}

// --- Construção Civil (opcional) ---

export interface NfseConstrucaoCivil {
  codigoObra?: string;
  art?: string; // Anotação de Responsabilidade Técnica
}

// --- Request principal de emissão ---

export interface NfseEmitirRequest {
  prestador: NfsePrestador;
  tomador: NfseTomador;
  intermediario?: NfseIntermediario;
  servico: NfseServico;
  valores: NfseValores;
  rps: NfseRps;
  construcaoCivil?: NfseConstrucaoCivil;
  /** Informações complementares */
  informacoesComplementares?: string;
  /** Certificado digital A1 */
  certificado: CertificateData;
  /** Ambiente de emissão (sobrescreve SEFAZ_AMBIENTE do servidor) */
  ambiente?: 'producao' | 'homologacao';
}

// --- Request de lote ---

export interface NfseEnviarLoteRequest {
  prestador: Pick<NfsePrestador, 'cnpj' | 'inscricaoMunicipal'>;
  /** Lista de RPS para envio em lote (máximo definido pelo município, geralmente 50) */
  rps: NfseEmitirRequest[];
  /** Certificado digital A1 */
  certificado: CertificateData;
}

// --- Request de consulta ---

export interface NfseConsultarLoteRequest {
  prestador: Pick<NfsePrestador, 'cnpj' | 'inscricaoMunicipal'>;
  protocolo: string;
  certificado: CertificateData;
  /** Código IBGE do município — necessário para rotear ao provider correto (Betha vs ADN) */
  codigoMunicipio?: string;
}

export interface NfseConsultarNfseRequest {
  prestador: Pick<NfsePrestador, 'cnpj' | 'inscricaoMunicipal'>;
  /** Id do DPS (45 chars, "DPS"+42 dígitos) — consulta direta GET /dps/{id},
   *  usada na recuperação pós-timeout quando o caller já tem o Id. */
  idDps?: string;
  /** Chave de acesso da NFS-e (50 dígitos — Padrão Nacional). Consulta direta GET /nfse/{chave}. */
  chaveAcesso?: string;
  /** Número da NFS-e */
  numero?: number;
  /**
   * Série do DPS — usada (com `numero` + `codigoMunicipio` + CNPJ do prestador)
   * para derivar o Id do DPS e recuperar a NFS-e via GET /dps/{idDps}
   * quando a chave de acesso não é conhecida (ex: timeout na emissão).
   */
  serie?: string;
  /** Protocolo de processamento (Betha Cloud) */
  protocolo?: string;
  /** Código IBGE do município (Betha Cloud) */
  codigoMunicipio?: string;
  /** Período inicial (YYYY-MM-DD) */
  dataInicial?: string;
  /** Período final (YYYY-MM-DD) */
  dataFinal?: string;
  tomador?: Pick<NfseTomador, 'cpf' | 'cnpj' | 'inscricaoMunicipal'>;
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
}

// --- Request de cancelamento ---

export interface NfseCancelarRequest {
  prestador: Pick<NfsePrestador, 'cnpj' | 'inscricaoMunicipal'>;
  /** Número da NFS-e a cancelar */
  numero: number;
  /** Chave de acesso da NFS-e (50 dígitos — Betha Cloud) */
  chaveNFSe?: string;
  /** Código do município (IBGE) */
  codigoMunicipio: string;
  /**
   * Código de cancelamento:
   * 1=Erro na emissão, 2=Serviço não prestado,
   * 3=Duplicidade, 4=Erro de processamento
   */
  codigoCancelamento: '1' | '2' | '3' | '4';
  /** Motivo do cancelamento (texto livre) */
  motivo?: string;
  certificado: CertificateData;
  /** Ambiente de emissão — sobrescreve SEFAZ_AMBIENTE do servidor */
  ambiente?: 'producao' | 'homologacao';
}

// --- Resposta ---

export interface NfseResponse {
  success: boolean;
  status: 'autorizado' | 'rejeitado' | 'processando' | 'cancelado' | 'erro';
  /** Número da NFS-e gerada (quando autorizado) */
  numeroNfse?: number;
  /** Chave de acesso da NFS-e (50 dígitos, Padrão Nacional) — exigida para cancelar */
  chaveAcesso?: string;
  /** Código de verificação da NFS-e */
  codigoVerificacao?: string;
  /** Protocolo do lote (para consulta assíncrona) */
  protocolo?: string;
  /** Data/hora de emissão */
  dataEmissao?: string;
  /** URL de visualização da NFS-e */
  linkVisualizacao?: string;
  /** XML completo da NFS-e autorizada */
  xml?: string;
  /** Mensagens de retorno */
  mensagens?: NfseMensagemRetorno[];
}

export interface NfseMensagemRetorno {
  codigo: string;
  mensagem: string;
  correcao?: string;
}
