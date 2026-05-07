// =====================================================================
// Canonical fiscal types — the source of truth for all modules.
// Migrated from legacy/types/index.ts. Trimmed to what the new modules
// actually consume; resurrect more shapes as we wire each module up.
// =====================================================================

export type SefazAmbiente = 'producao' | 'homologacao';
export type TpAmb = '1' | '2'; // 1=Produção, 2=Homologação

export interface CertificateData {
  pfxBase64: string;
  password: string;
}

// --- Address / parties ---

export interface Endereco {
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  codigoMunicipio: string;
  municipio: string;
  uf: string;
  cep: string;
  codigoPais?: string;
  pais?: string;
  telefone?: string;
}

export interface NFeEmitente {
  cnpj: string;
  nome: string;
  nomeFantasia?: string;
  inscricaoEstadual: string;
  inscricaoMunicipal?: string;
  crt: '1' | '2' | '3';
  endereco: Endereco;
}

export interface NFeDestinatario {
  cpf?: string;
  cnpj?: string;
  idEstrangeiro?: string;
  nome: string;
  email?: string;
  inscricaoEstadual?: string;
  indicadorIE: '1' | '2' | '9';
  endereco?: Endereco;
}

// --- Items / taxes (unchanged from legacy) ---

export interface NFeItemImposto {
  icms: {
    orig: string;
    cst?: string;
    csosn?: string;
    modBC?: string;
    valorBC?: number;
    aliquota?: number;
    valor?: number;
    modBCST?: string;
    valorBCST?: number;
    aliquotaST?: number;
    valorST?: number;
    pRedBC?: number;
  };
  pis: { cst: string; valorBC?: number; aliquota?: number; valor?: number };
  cofins: { cst: string; valorBC?: number; aliquota?: number; valor?: number };
  ipi?: { cst: string; valorBC?: number; aliquota?: number; valor?: number; cEnq: string };
}

export interface NFeItem {
  numero: number;
  produto: {
    codigo: string;
    cEAN: string;
    descricao: string;
    ncm: string;
    cest?: string;
    cfop: string;
    unidade: string;
    quantidade: number;
    valorUnitario: number;
    valorTotal: number;
    cEANTrib: string;
    unidadeTrib: string;
    quantidadeTrib: number;
    valorUnitarioTrib: number;
    valorDesconto?: number;
    valorFrete?: number;
    valorSeguro?: number;
    valorOutro?: number;
    indTot: '0' | '1';
  };
  imposto: NFeItemImposto;
}

export interface NFeTransporte {
  modFrete: '0' | '1' | '2' | '3' | '4' | '9';
  transportadora?: {
    cnpj?: string;
    cpf?: string;
    nome?: string;
    inscricaoEstadual?: string;
    endereco?: string;
    municipio?: string;
    uf?: string;
  };
  volumes?: Array<{
    quantidade?: number;
    especie?: string;
    marca?: string;
    numeracao?: string;
    pesoLiquido?: number;
    pesoBruto?: number;
  }>;
}

export interface NFePagamento {
  indicadorPagamento: '0' | '1';
  formas: Array<{
    tipo: string;
    valor: number;
    cartao?: {
      tipoIntegracao: '1' | '2';
      cnpj?: string;
      bandeira?: string;
      autorizacao?: string;
    };
  }>;
  troco?: number;
}

export interface NFeCobranca {
  fatura?: {
    numero?: string;
    valorOriginal?: number;
    valorDesconto?: number;
    valorLiquido?: number;
  };
  duplicatas?: Array<{ numero: string; vencimento: string; valor: number }>;
}

// --- Top-level requests / responses ---

export interface NFeRequest {
  emitente: NFeEmitente;
  destinatario: NFeDestinatario;
  itens: NFeItem[];
  naturezaOperacao: string;
  tipoOperacao: '0' | '1';
  finalidade: '1' | '2' | '3' | '4';
  consumidorFinal: '0' | '1';
  presencaComprador: '0' | '1' | '2' | '3' | '4' | '5' | '9';
  transporte: NFeTransporte;
  pagamento: NFePagamento;
  cobranca?: NFeCobranca;
  informacoesAdicionais?: { contribuinte?: string; fisco?: string };
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  serie?: string;
  numero: number;
  ufEmitente: string;
}

export interface NFCeRequest {
  emitente: NFeEmitente;
  consumidor?: { cpf?: string; cnpj?: string; nome?: string };
  itens: NFeItem[];
  pagamento: NFePagamento;
  transporte: NFeTransporte;
  csc: { id: string; token: string };
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  serie?: string;
  numero: number;
  ufEmitente: string;
  informacoesAdicionais?: { contribuinte?: string };
}

export interface SefazResponse {
  success: boolean;
  status: 'autorizado' | 'rejeitado' | 'processando' | 'denegado' | 'cancelado' | 'erro';
  codigoStatus: string;
  motivoStatus: string;
  chaveAcesso?: string;
  protocolo?: string;
  nRec?: string;
  dataRecebimento?: string;
  xml?: string;
  erros?: string[];
}

export interface RespTec {
  cnpj: string;
  contato: string;
  email: string;
  fone: string;
}

// --- MDF-e ---

export interface MdfeVeiculo {
  placa: string;
  renavam?: string;
  tara: number;
  capKG?: number;
  capM3?: number;
  tipoRodado: '01' | '02' | '03' | '04' | '05' | '06';
  tipoCarroceria: '00' | '01' | '02' | '03' | '04' | '05';
  uf: string;
  rntrc?: string;
}

export interface MdfeCondutor {
  nome: string;
  cpf: string;
}

export interface MdfeMunicipio {
  codigoMunicipio: string;
  nome: string;
}

export interface MdfeDescarga {
  codigoMunicipio: string;
  nomeMunicipio: string;
  chaves: string[];
}

export interface MdfeSeguro {
  responsavel: '1' | '2';
  cnpjResponsavel?: string;
  nomeSeguradora?: string;
  numeroApolice?: string;
  numeroAverbacao?: string[];
}

export interface MdfeRequest {
  emitente: {
    cnpj: string;
    inscricaoEstadual: string;
    nome: string;
    nomeFantasia?: string;
    endereco: Endereco;
  };
  modal: 'rodoviario';
  tpEmit?: '1' | '2';
  tpTransp?: '1' | '2' | '3';
  ufInicio: string;
  ufFim: string;
  municipiosCarregamento: MdfeMunicipio[];
  percurso?: string[];
  descargas: MdfeDescarga[];
  veiculo: MdfeVeiculo;
  reboques?: MdfeVeiculo[];
  condutores: MdfeCondutor[];
  produtoPredominante: {
    tipoCarga: string;
    descricao: string;
    cean?: string;
    ncm?: string;
  };
  valorTotalCarga: number;
  codigoUnidadePeso: '01' | '02';
  pesoBrutoTotal: number;
  seguro?: MdfeSeguro;
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  serie?: string;
  numero: number;
  informacoesAdicionais?: string;
  informacoesFisco?: string;
}

export interface MdfeEncerrarRequest {
  chaveAcesso: string;
  protocolo: string;
  codigoMunicipio: string;
  uf: string;
  dataEncerramento?: string;
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
}

export interface MdfeCancelarRequest {
  chaveAcesso: string;
  protocolo: string;
  justificativa: string;
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
}

// --- NFe events ---

export interface NFeCancelarRequest {
  chaveAcesso: string;
  protocolo: string;
  justificativa: string;
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  ufEmitente: string;
}

export interface NFeCartaCorrecaoRequest {
  chaveAcesso: string;
  correcao: string;
  sequencia?: number;
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  ufEmitente: string;
}

export interface NFeInutilizarRequest {
  cnpj: string;
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  modelo: '55' | '65';
  ano: string;
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  ufEmitente: string;
}

export interface NFeConsultaRequest {
  chaveAcesso: string;
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  ufEmitente: string;
}

export interface StatusServicoRequest {
  certificado: CertificateData;
  ambiente?: SefazAmbiente;
  ufEmitente: string;
  modelo?: '55' | '65';
}
