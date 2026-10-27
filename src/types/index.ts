// ============================================================
// TIPOS COMPARTILHADOS - SEFAZ API
// ============================================================

// --- Ambiente ---
export type SefazAmbiente = 'producao' | 'homologacao';
export type TpAmb = '1' | '2'; // 1=Produção, 2=Homologação

// --- Certificado ---
export interface CertificateInfo {
  id: string;
  tenantId: string;
  filename: string;
  subject: string;
  serialNumber: string;
  validFrom: string;
  validUntil: string;
  isValid: boolean;
  daysUntilExpiry: number;
}

export interface CertificateData {
  pfxBase64: string;
  password: string;
}

// --- NFe ---
export interface NFeEmitente {
  cnpj: string;
  nome: string;
  nomeFantasia?: string;
  inscricaoEstadual: string;
  inscricaoMunicipal?: string;
  crt: '1' | '2' | '3'; // 1=Simples, 2=Simples excesso, 3=Normal
  endereco: Endereco;
}

export interface NFeDestinatario {
  cpf?: string;
  cnpj?: string;
  idEstrangeiro?: string;
  nome: string;
  email?: string;
  inscricaoEstadual?: string;
  indicadorIE: '1' | '2' | '9'; // 1=Contribuinte, 2=Isento, 9=Não contribuinte
  endereco?: Endereco;
}

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

export interface NFeItem {
  numero: number; // nItem
  produto: {
    codigo: string;
    cEAN: string; // GTIN/EAN, 'SEM GTIN' se não tiver
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
    indTot: '0' | '1'; // 0=Não compõe total, 1=Compõe
  };
  imposto: NFeItemImposto;
}

export interface NFeItemImposto {
  icms: {
    orig: string; // 0=Nacional, 1=Estrangeira importação, 2=Estrangeira adquirida
    cst?: string; // CST ICMS (regime normal)
    csosn?: string; // CSOSN (Simples Nacional)
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
  pis: {
    cst: string;
    valorBC?: number;
    aliquota?: number;
    valor?: number;
  };
  cofins: {
    cst: string;
    valorBC?: number;
    aliquota?: number;
    valor?: number;
  };
  ipi?: {
    cst: string;
    valorBC?: number;
    aliquota?: number;
    valor?: number;
    cEnq: string; // Código de enquadramento
  };
}

export interface NFeTransporte {
  modFrete: '0' | '1' | '2' | '3' | '4' | '9'; // 0=Emitente, 1=Destinatário, 2=Terceiros, 9=Sem frete
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
  indicadorPagamento: '0' | '1'; // 0=À vista, 1=A prazo
  formas: Array<{
    tipo: string; // tPag: 01=Dinheiro, 03=Cartão Crédito, 04=Cartão Débito, 17=PIX, etc.
    /** xPag: descrição do meio de pagamento. OBRIGATÓRIO quando tPag=99 (Outros). */
    descricao?: string;
    valor: number;
    cartao?: {
      tipoIntegracao: '1' | '2'; // 1=Integrado, 2=Não integrado
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
  duplicatas?: Array<{
    numero: string;
    vencimento: string; // YYYY-MM-DD
    valor: number;
  }>;
}

/**
 * Referência a uma NF-e anterior (tag <NFref> dentro de <ide>).
 * Obrigatório quando finalidade=4 (devolução) — sem isso a SEFAZ rejeita
 * com erro "nota nova inválida".
 *
 * MVP: apenas refNFe (chave de acesso da nota original, 44 dígitos).
 * Não cobre <refNF> manual (NF-e legada não cadastrada na SEFAZ) — caso
 * raro; adicionar depois se aparecer demanda.
 */
export interface NFeReference {
  /** Chave de acesso da NF-e original (44 dígitos numéricos). */
  refNFe: string;
}

export interface NFeRequest {
  emitente: NFeEmitente;
  destinatario: NFeDestinatario;
  itens: NFeItem[];
  naturezaOperacao: string;
  tipoOperacao: '0' | '1'; // 0=Entrada, 1=Saída
  finalidade: '1' | '2' | '3' | '4'; // 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução
  /**
   * Referências a NF-e anteriores. Obrigatório (1..n) quando
   * finalidade='4'. SEFAZ aceita até 500 refs por nota.
   */
  referencias?: NFeReference[];
  consumidorFinal: '0' | '1';
  presencaComprador: '0' | '1' | '2' | '3' | '4' | '5' | '9';
  transporte: NFeTransporte;
  pagamento: NFePagamento;
  cobranca?: NFeCobranca;
  informacoesAdicionais?: {
    contribuinte?: string;
    fisco?: string;
  };
  // Certificado digital
  certificado: CertificateData;
  // Ambiente de emissão (sobrescreve SEFAZ_AMBIENTE do servidor)
  ambiente?: 'producao' | 'homologacao';
  // Série (padrão '1' para NFe)
  serie?: string;
  // Número da nota (OBRIGATÓRIO — sequencial, controlado pelo emissor)
  numero: number;
  // UF do emitente (para selecionar o webservice correto)
  ufEmitente: string;
}

// --- NFCe ---

/**
 * Contingência off-line da NFC-e (tpEmis=9).
 * Quando SEFAZ está indisponível, o emissor gera o XML com chave própria,
 * assina, imprime DANFCE com aviso "EM CONTINGÊNCIA" e dá ao consumidor.
 * O XML pré-assinado fica salvo até a SEFAZ voltar, quando é transmitido
 * via /nfce/contingencia/transmit. SEFAZ aceita até 24h após dhCont.
 */
export interface NFCeContingencia {
  /** Data/hora de entrada em contingência (ISO 8601). */
  dhCont: string;
  /** Justificativa (mín. 15, máx. 256 caracteres). */
  xJust: string;
}

export interface NFCeRequest {
  emitente: NFeEmitente;
  consumidor?: {
    cpf?: string;
    cnpj?: string;
    nome?: string;
  };
  itens: NFeItem[];
  pagamento: NFePagamento;
  transporte: NFeTransporte;
  csc: {
    id: string;
    token: string;
  };
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
  serie?: string;
  numero: number;
  ufEmitente: string;
  informacoesAdicionais?: {
    contribuinte?: string;
  };
  /**
   * Quando presente, o XML é gerado com tpEmis=9 (contingência off-line)
   * + dhCont + xJust. Usado pelo endpoint /nfce/contingencia/prepare —
   * o XML é assinado mas NÃO enviado pra SEFAZ no mesmo request.
   */
  contingencia?: NFCeContingencia;
}

// --- MDF-e ---
export interface MdfeVeiculo {
  placa: string;
  renavam?: string;
  tara: number; // Peso em KG
  capKG?: number;
  capM3?: number;
  tipoRodado: '01' | '02' | '03' | '04' | '05' | '06'; // 01=Truck, 02=Toco, 03=Cavalo, 04=VAN, 05=Utilitário, 06=Outros
  tipoCarroceria: '00' | '01' | '02' | '03' | '04' | '05'; // 00=Aberta, 01=Fechada, 02=Graneleira, etc.
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
  chaves: string[]; // Chaves NFe (44 dígitos)
}

export interface MdfeSeguro {
  responsavel: '1' | '2'; // 1=Emitente, 2=Contratante
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
  tpEmit?: '1' | '2'; // 1=Prestador de serviço, 2=Carga própria (default '2')
  tpTransp?: '1' | '2' | '3'; // 1=ETC, 2=TAC, 3=CTC (somente quando tpEmit='1')
  ufInicio: string;
  ufFim: string;
  municipiosCarregamento: MdfeMunicipio[];
  percurso?: string[]; // UFs de percurso
  descargas: MdfeDescarga[];
  veiculo: MdfeVeiculo;
  reboques?: MdfeVeiculo[];
  condutores: MdfeCondutor[];
  produtoPredominante: {
    tipoCarga: string; // 01-12
    descricao: string;
    cean?: string;
    ncm?: string;
  };
  valorTotalCarga: number;
  codigoUnidadePeso: '01' | '02'; // 01=KG, 02=TON
  pesoBrutoTotal: number;
  seguro?: MdfeSeguro;
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
  serie?: string;
  numero: number;
  informacoesAdicionais?: string;
  informacoesFisco?: string;
}

// --- Respostas ---
export interface SefazResponse {
  success: boolean;
  status: 'autorizado' | 'rejeitado' | 'processando' | 'denegado' | 'cancelado' | 'erro';
  codigoStatus: string;
  motivoStatus: string;
  chaveAcesso?: string;
  protocolo?: string;
  nRec?: string; // Número do recibo (para polling assíncrono)
  dataRecebimento?: string;
  xml?: string; // XML autorizado (assinado + protocolo)
  /** NF-e/NFC-e assinada que foi à SEFAZ, quando o desfecho ficou incerto (processando,
   *  falha de comunicação depois de assinar). Guarde-a e mande de volta em
   *  `/nfe/consultar` (`xmlAssinado`): se a SEFAZ autorizou, a consulta devolve o nfeProc. */
  xmlAssinado?: string;
  /** Na consulta de nota cancelada: o procEventoNFe do cancelamento, como a SEFAZ o registrou. */
  xmlCancelamento?: string;
  /**
   * O pedido não chegou à SEFAZ (circuito aberto, sem conexão, 503): o documento não existe
   * lá e o número continua livre. Vem sem chave e sem XML assinado — não há o que consultar.
   */
  naoEnviado?: boolean;
  erros?: string[];
  /** Fragmento <protNFe> literal extraído da resposta SOAP da SEFAZ.
   *  Uso interno para montar o nfeProc com o protocolo real (verAplic/digVal);
   *  removido da resposta antes de devolver ao cliente. */
  protNFeXml?: string;
}

export interface MdfeEncerrarRequest {
  chaveAcesso: string;
  protocolo: string;
  codigoMunicipio: string;
  uf: string;
  dataEncerramento?: string; // YYYY-MM-DD
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
}

export interface MdfeIncluirCondutorRequest {
  chaveAcesso: string;
  /** Protocolo de autorização — aceito por compat com o cliente, não usado no evento 110114. */
  protocolo?: string;
  condutor: { nome: string; cpf: string };
  /** Sequência do evento (1-99) — incrementar a cada condutor incluído na mesma chave. */
  nSeqEvento?: number;
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
}

export interface MdfeCancelarRequest {
  chaveAcesso: string;
  protocolo: string;
  justificativa: string; // 15-255 chars
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
}

export interface NFeCancelarRequest {
  chaveAcesso: string;
  protocolo: string;
  justificativa: string; // 15-255 chars
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
  ufEmitente: string;
  /**
   * Cancelamento por substituição (NFC-e, evento 110112, NT 2018.004): a chave da NFC-e emitida
   * em contingência off-line (tpEmis 9) no lugar desta, que ficou sem resposta e foi autorizada.
   * A substituta precisa estar autorizada, com o mesmo total e o mesmo número de itens; prazo de
   * 168 horas.
   */
  chaveSubstituta?: string;
}

export interface NFeCartaCorrecaoRequest {
  chaveAcesso: string;
  correcao: string; // 15-1000 chars
  sequencia?: number; // Sequência do evento (default 1)
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
  ufEmitente: string;
}

export interface NFeInutilizarRequest {
  cnpj: string;
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string; // 15-255 chars
  modelo: '55' | '65'; // 55=NFe, 65=NFCe
  ano: string; // 2 dígitos
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
  ufEmitente: string;
}

export interface NFeConsultaRequest {
  chaveAcesso: string;
  /** A NF-e/NFC-e assinada (o `xmlAssinado` de uma emissão incerta). Com ela, a consulta
   *  de nota autorizada ou denegada devolve o nfeProc em `xml`. */
  xmlAssinado?: string;
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
  ufEmitente: string;
}

export interface StatusServicoRequest {
  certificado: CertificateData;
  ambiente?: 'producao' | 'homologacao';
  ufEmitente: string;
  modelo?: '55' | '65'; // 55=NFe, 65=NFCe
}
