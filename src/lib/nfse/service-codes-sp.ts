// ============================================================
// De-para: Código de serviço LC 116/2003 → Código municipal São Paulo
//
// Fonte oficial: Anexo 1 da IN SF/SUREM 08/2011, atualizado até
// IN SF/SUREM 06/2023 — Prefeitura de São Paulo.
//
// Lista completa e atualizações:
//   https://prefeitura.sp.gov.br/web/fazenda/w/2497
//
// ATENÇÃO: A partir de 01/01/2026 novos códigos serão criados em
// decorrência da Reforma Tributária (LC 214/2025 — IBS e CBS).
// Consulte: https://notadomilhao.sf.prefeitura.sp.gov.br
//
// Formato no XML: string de 4-5 dígitos (o provider faz padStart 5).
// ============================================================

/**
 * Tabela de conversão LC 116 → código municipal de São Paulo (PJ).
 * Chave: código LC 116 (ex: "01.07"), valor: código SP numérico.
 */
export const LC116_TO_SP: Record<string, string> = {
  // ── Grupo 01 — Informática e congêneres ──────────────────────
  '01.01': '2660',  // Análise e desenvolvimento de sistemas
  '01.02': '2668',  // Programação
  '01.03': '2684',  // Processamento, armazenamento ou hospedagem de dados
  '01.04': '2692',  // Elaboração de programas de computadores (software)
  '01.05': '2800',  // Licenciamento ou cessão de direito de uso de programas
  '01.06': '2881',  // Assessoria e consultoria em informática
  '01.07': '2919',  // Suporte técnico em informática, instalação e manutenção
  '01.08': '2935',  // Planejamento, confecção e atualização de páginas eletrônicas
  '01.09': '2684',  // Disponibilização de conteúdos de áudio, vídeo, imagem e texto

  // ── Grupo 02 — Pesquisa e desenvolvimento ────────────────────
  '02.01': '6629',  // Pesquisa e desenvolvimento de qualquer natureza

  // ── Grupo 04 — Saúde e assistência médica ────────────────────
  '04.01': '4030',  // Medicina e biomedicina
  '04.02': '4111',  // Análises clínicas, patologia, eletricidade médica
  '04.03': '4030',  // Hospitais, clínicas, laboratórios, sanatórios
  '04.06': '4170',  // Enfermagem, inclusive serviços auxiliares
  '04.07': '4669',  // Serviços farmacêuticos
  '04.08': '4200',  // Terapia ocupacional, fisioterapia e fonoaudiologia
  '04.12': '4294',  // Odontologia
  '04.15': '4464',  // Psicanálise
  '04.16': '4472',  // Psicologia

  // ── Grupo 05 — Medicina veterinária ──────────────────────────
  '05.01': '5011',  // Medicina veterinária e zootecnia

  // ── Grupo 06 — Educação ───────────────────────────────────────
  '06.01': '6130',  // Ensino regular pré-escolar, fundamental, médio e superior
  '06.02': '6181',  // Instrução, treinamento e orientação pedagógica
  '06.03': '6181',  // Elaboração e ministração de cursos e treinamentos

  // ── Grupo 07 — Engenharia e construção civil ──────────────────
  '07.01': '1520',  // Engenharia, agronomia, arquitetura, urbanismo (empresa)
  '07.02': '1023',  // Execução de obras de construção civil (empreitada)
  '07.03': '1694',  // Elaboração de planos diretores e projetos de engenharia
  '07.04': '1872',  // Demolição
  '07.05': '1023',  // Reparação, conservação e reforma de edifícios
  '07.09': '7501',  // Varrição, coleta, remoção e tratamento de lixo
  '07.10': '7501',  // Limpeza e conservação de vias e logradouros
  '07.11': '1686',  // Decoração e jardinagem
  '07.17': '1805',  // Acompanhamento e fiscalização de obras de engenharia

  // ── Grupo 10 — Serviços de intermediação ─────────────────────
  '10.01': '8680',  // Agenciamento de câmbio
  '10.02': '8753',  // Agenciamento de seguros
  '10.05': '8842',  // Agenciamento de contratos de arrendamento mercantil (leasing)

  // ── Grupo 14 — Manutenção e reparação ────────────────────────
  '14.01': '2285',  // Lubrificação, limpeza e revisão de máquinas e veículos
  '14.02': '2285',  // Assistência técnica
  '14.05': '2315',  // Restauração, recondicionamento e pintura de veículos
  '14.06': '2323',  // Instalação e montagem de aparelhos, máquinas e equipamentos

  // ── Grupo 17 — Apoio técnico, administrativo e consultoria ───
  '17.01': '3115',  // Assessoria ou consultoria de qualquer natureza
  '17.02': '3093',  // Datilografia, digitação, estenografia, secretaria
  '17.04': '3212',  // Recrutamento, agenciamento e seleção de mão de obra
  '17.06': '3255',  // Propaganda e publicidade, inclusive promoção de vendas
  '17.08': '3301',  // Perícias, laudos e análises técnicas
  '17.10': '3395',  // Organização de festas e recepções
  '17.13': '3220',  // Advocacia
  '17.14': '3263',  // Arbitragem de qualquer espécie
  '17.15': '3107',  // Auditoria
  '17.16': '3115',  // Análise de Organização e Métodos
  '17.17': '3085',  // Atuária e cálculos técnicos de qualquer natureza
  '17.18': '3476',  // Contabilidade, inclusive serviços técnicos e auxiliares
  '17.19': '3093',  // Consultoria e assessoria econômica ou financeira
  '17.20': '3107',  // Estatística
  '17.21': '3484',  // Cobrança em geral
  '17.23': '3492',  // Apresentação de palestras, conferências, seminários

  // ── Grupo 21 — Serviços de registros públicos ─────────────────
  '21.01': '9270',  // Serviços de registros públicos, cartorários e notariais

  // ── Grupo 25 — Serviços funerários ───────────────────────────
  '25.01': '9377',  // Funerais, fornecimento de caixão e cremação
};

/**
 * Resolve o código de serviço municipal de São Paulo a partir do código LC 116.
 * Retorna null se não houver mapeamento — nesse caso o usuário deve informar
 * o código manualmente via `codigoTributacaoMunicipio`.
 */
export function resolveCodigoServicoSP(lc116: string): string | null {
  return LC116_TO_SP[lc116.trim()] ?? null;
}
