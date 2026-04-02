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
  /** Regime especial de tributação:
   * 1=Microempresa Municipal, 2=Estimativa, 3=Sociedade de Profissionais,
   * 4=Cooperativa, 5=MEI, 6=ME/EPP Simples Nacional */
  regimeEspecialTributacao?: '1' | '2' | '3' | '4' | '5' | '6';
  /** Optante Simples Nacional */
  optanteSimplesNacional: boolean;
  /** Incentivador cultural */
  incentivadorCultural?: boolean;
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
}

export interface NfseConsultarNfseRequest {
  prestador: Pick<NfsePrestador, 'cnpj' | 'inscricaoMunicipal'>;
  /** Número da NFS-e */
  numero?: number;
  /** Período inicial (YYYY-MM-DD) */
  dataInicial?: string;
  /** Período final (YYYY-MM-DD) */
  dataFinal?: string;
  tomador?: Pick<NfseTomador, 'cpf' | 'cnpj' | 'inscricaoMunicipal'>;
  certificado: CertificateData;
}

// --- Request de cancelamento ---

export interface NfseCancelarRequest {
  prestador: Pick<NfsePrestador, 'cnpj' | 'inscricaoMunicipal'>;
  /** Número da NFS-e a cancelar */
  numero: number;
  /** Código do município (IBGE) */
  codigoMunicipio: string;
  /**
   * Código de cancelamento:
   * 1=Erro na emissão, 2=Serviço não prestado,
   * 3=Duplicidade, 4=Erro de processamento
   */
  codigoCancelamento: '1' | '2' | '3' | '4';
  certificado: CertificateData;
}

// --- Resposta ---

export interface NfseResponse {
  success: boolean;
  status: 'autorizado' | 'rejeitado' | 'processando' | 'cancelado' | 'erro';
  /** Número da NFS-e gerada (quando autorizado) */
  numeroNfse?: number;
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
