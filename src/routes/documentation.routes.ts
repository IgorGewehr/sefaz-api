import { Router, Request, Response } from 'express';

const router = Router();

const documentation = {
  api: {
    name: 'SEFAZ API - Emissão Fiscal Eletrônica',
    version: '1.0.0',
    description: 'API REST para emissão, consulta, cancelamento e gestão de documentos fiscais eletrônicos (NFe, NFCe, MDF-e) integrada diretamente com os webservices da SEFAZ brasileira via SOAP/mTLS.',
    base_url: '{SUA_BASE_URL}',
    protocol: 'HTTPS',
    content_type: 'application/json',
    max_payload: '2MB',
  },

  autenticacao: {
    tipo: 'Bearer Token',
    header: 'Authorization',
    formato: 'Bearer {SEU_TOKEN}',
    descricao: 'Todas as rotas fiscais exigem autenticação via API Key no header Authorization. O health check (GET /health) é público.',
    exemplo: {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {SEU_TOKEN}',
      },
    },
    respostas_erro: {
      '401': { error: 'Token de autenticação não fornecido' },
      '403': { error: 'Token de autenticação inválido' },
    },
  },

  certificado_digital: {
    descricao: 'Todos os endpoints fiscais exigem um certificado digital A1 (formato PFX) enviado no corpo da requisição. O certificado é usado para assinar digitalmente os XMLs e autenticar via mTLS com a SEFAZ.',
    formato: {
      certificado: {
        pfxBase64: 'string — conteúdo do arquivo .pfx codificado em base64',
        password: 'string — senha do certificado',
      },
    },
    notas: [
      'O certificado NÃO é armazenado no servidor — é usado apenas durante a requisição.',
      'Certificados expirados serão rejeitados.',
      'Use certificado tipo A1 (arquivo .pfx/.p12).',
    ],
  },

  ambientes: {
    descricao: 'A API opera em dois ambientes SEFAZ.',
    valores: {
      homologacao: 'Ambiente de testes — NFe/NFCe sem valor fiscal.',
      producao: 'Ambiente real — documentos com validade fiscal.',
    },
    nota: 'O ambiente é configurado no servidor. Consulte o administrador para saber qual ambiente está ativo.',
  },

  endpoints: {
    publicos: [
      {
        method: 'GET',
        path: '/health',
        descricao: 'Verifica se a API está online.',
        autenticacao: false,
        request_body: null,
        resposta: {
          status: 200,
          body: { status: 'ok', timestamp: '2026-03-09T00:00:00.000Z' },
        },
      },
      {
        method: 'GET',
        path: '/documentation',
        descricao: 'Esta documentação.',
        autenticacao: false,
        request_body: null,
      },
    ],

    nfe: [
      {
        method: 'POST',
        path: '/nfe/emitir',
        descricao: 'Emite uma Nota Fiscal Eletrônica (modelo 55). Assina o XML, envia à SEFAZ e retorna o resultado com protocolo de autorização.',
        autenticacao: true,
        request_body: {
          emitente: {
            _tipo: 'object — OBRIGATÓRIO',
            cnpj: 'string — CNPJ do emitente (14 dígitos, sem formatação)',
            nome: 'string — Razão social',
            nomeFantasia: 'string — Opcional',
            inscricaoEstadual: 'string — IE do emitente',
            inscricaoMunicipal: 'string — Opcional',
            crt: "'1' | '2' | '3' — Código de Regime Tributário (1=Simples Nacional, 2=Simples excesso sublimite, 3=Regime Normal)",
            endereco: {
              logradouro: 'string',
              numero: 'string',
              complemento: 'string — Opcional',
              bairro: 'string',
              codigoMunicipio: 'string — Código IBGE do município (7 dígitos)',
              municipio: 'string — Nome do município',
              uf: 'string — Sigla UF (2 letras)',
              cep: 'string — CEP (8 dígitos)',
              telefone: 'string — Opcional',
            },
          },
          destinatario: {
            _tipo: 'object — OBRIGATÓRIO',
            cpf: 'string — CPF (usar cpf OU cnpj OU idEstrangeiro)',
            cnpj: 'string — CNPJ',
            idEstrangeiro: 'string — ID estrangeiro',
            nome: 'string — Nome/razão social',
            email: 'string — Opcional',
            inscricaoEstadual: 'string — Opcional',
            indicadorIE: "'1' | '2' | '9' — 1=Contribuinte ICMS, 2=Isento, 9=Não contribuinte",
            endereco: 'object — Mesmo formato do emitente (opcional para NFe)',
          },
          itens: {
            _tipo: 'array — OBRIGATÓRIO, mínimo 1 item',
            _exemplo_item: {
              numero: 'number — Número sequencial do item (1, 2, 3...)',
              produto: {
                codigo: 'string — Código interno do produto',
                cEAN: "string — GTIN/EAN ou 'SEM GTIN'",
                descricao: 'string — Descrição do produto',
                ncm: 'string — NCM (8 dígitos)',
                cest: 'string — CEST (opcional)',
                cfop: 'string — CFOP (4 dígitos, ex: 5102)',
                unidade: 'string — Unidade comercial (UN, KG, etc.)',
                quantidade: 'number',
                valorUnitario: 'number',
                valorTotal: 'number — quantidade × valorUnitario',
                cEANTrib: "string — GTIN tributário ou 'SEM GTIN'",
                unidadeTrib: 'string — Unidade tributária',
                quantidadeTrib: 'number',
                valorUnitarioTrib: 'number',
                valorDesconto: 'number — Opcional',
                valorFrete: 'number — Opcional',
                valorSeguro: 'number — Opcional',
                valorOutro: 'number — Opcional',
                indTot: "'0' | '1' — 0=Não compõe total, 1=Compõe total da NF",
              },
              imposto: {
                icms: {
                  orig: "'0' | '1' | '2' — Origem (0=Nacional, 1=Estrangeira importação, 2=Estrangeira adquirida)",
                  cst: "string — CST ICMS para regime normal (00, 10, 20, 30, 40, 41, 50, 51, 60, 70, 90)",
                  csosn: "string — CSOSN para Simples Nacional (101, 102, 103, 201, 202, 203, 300, 400, 500, 900)",
                  modBC: "string — Modalidade BC ICMS (0=Margem, 1=Pauta, 2=Preço tabelado, 3=Valor operação)",
                  valorBC: 'number — Base de cálculo',
                  aliquota: 'number — Alíquota ICMS (%)',
                  valor: 'number — Valor ICMS',
                  pRedBC: 'number — Percentual redução BC (opcional)',
                },
                pis: {
                  cst: "string — CST PIS (01, 02, 03, 04, 05, 06, 07, 08, 09, 49, 50-75, 98, 99)",
                  valorBC: 'number — Opcional',
                  aliquota: 'number — Opcional',
                  valor: 'number — Opcional',
                },
                cofins: {
                  cst: "string — CST COFINS (mesmos valores do PIS)",
                  valorBC: 'number — Opcional',
                  aliquota: 'number — Opcional',
                  valor: 'number — Opcional',
                },
                ipi: {
                  _tipo: 'object — Opcional (apenas para produtos industrializados)',
                  cst: 'string — CST IPI',
                  valorBC: 'number',
                  aliquota: 'number',
                  valor: 'number',
                  cEnq: 'string — Código de enquadramento (geralmente "999")',
                },
              },
            },
          },
          naturezaOperacao: 'string — Ex: "VENDA DE MERCADORIA", "REMESSA", "DEVOLUCAO"',
          tipoOperacao: "'0' | '1' — 0=Entrada, 1=Saída",
          finalidade: "'1' | '2' | '3' | '4' — 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução",
          consumidorFinal: "'0' | '1' — 0=Não, 1=Consumidor final",
          presencaComprador: "'0' | '1' | '2' | '3' | '4' | '5' | '9' — 0=Não se aplica, 1=Presencial, 2=Internet, 3=Teleatendimento, 4=Entrega domicílio, 5=Presencial fora do estado, 9=Outros",
          transporte: {
            modFrete: "'0' | '1' | '2' | '3' | '4' | '9' — 0=Emitente, 1=Destinatário, 2=Terceiros, 3=Próprio remetente, 4=Próprio destinatário, 9=Sem frete",
            transportadora: {
              _tipo: 'object — Opcional',
              cnpj: 'string',
              cpf: 'string',
              nome: 'string',
              inscricaoEstadual: 'string',
              endereco: 'string',
              municipio: 'string',
              uf: 'string',
            },
            volumes: {
              _tipo: 'array — Opcional',
              _exemplo: {
                quantidade: 'number',
                especie: 'string — Ex: CAIXA, PACOTE',
                marca: 'string',
                numeracao: 'string',
                pesoLiquido: 'number (kg)',
                pesoBruto: 'number (kg)',
              },
            },
          },
          pagamento: {
            _tipo: 'object — OBRIGATÓRIO',
            indicadorPagamento: "'0' | '1' — 0=À vista, 1=A prazo",
            formas: {
              _tipo: 'array — OBRIGATÓRIO, mínimo 1',
              _exemplo: {
                tipo: "string — tPag: '01'=Dinheiro, '02'=Cheque, '03'=Cartão crédito, '04'=Cartão débito, '05'=Crédito loja, '10'=Vale alimentação, '11'=Vale refeição, '12'=Vale presente, '13'=Vale combustível, '15'=Boleto, '16'=Depósito, '17'=PIX, '18'=Transferência, '90'=Sem pagamento, '99'=Outros",
                valor: 'number',
                cartao: {
                  _tipo: 'object — Obrigatório se tipo=03 ou 04',
                  tipoIntegracao: "'1' | '2' — 1=Integrado, 2=Não integrado",
                  cnpj: 'string — CNPJ credenciadora',
                  bandeira: 'string — Bandeira (01=Visa, 02=Master, etc.)',
                  autorizacao: 'string — Número autorização',
                },
              },
            },
            troco: 'number — Opcional, valor do troco',
          },
          cobranca: {
            _tipo: 'object — Opcional (para vendas a prazo)',
            fatura: {
              numero: 'string',
              valorOriginal: 'number',
              valorDesconto: 'number',
              valorLiquido: 'number',
            },
            duplicatas: {
              _tipo: 'array',
              _exemplo: {
                numero: 'string',
                vencimento: 'string — Formato YYYY-MM-DD',
                valor: 'number',
              },
            },
          },
          informacoesAdicionais: {
            _tipo: 'object — Opcional',
            contribuinte: 'string — Informações ao contribuinte (até 5000 chars)',
            fisco: 'string — Informações ao fisco (até 2000 chars)',
          },
          certificado: {
            pfxBase64: 'string — OBRIGATÓRIO',
            password: 'string — OBRIGATÓRIO',
          },
          serie: "string — Série da NF (default '1')",
          numero: 'number — OBRIGATÓRIO, número sequencial da NF (>= 1)',
          ufEmitente: 'string — OBRIGATÓRIO, código UF IBGE do emitente (ex: 35 para SP)',
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '100',
            motivoStatus: 'Autorizado o uso da NF-e',
            chaveAcesso: 'string — 44 dígitos (chave de acesso da NFe)',
            protocolo: 'string — Número do protocolo de autorização',
            dataRecebimento: 'string — ISO 8601',
            xml: 'string — XML assinado com protocolo (para armazenamento/DANFE); também na denegada',
            xmlAssinado: 'string — só no desfecho incerto (processando/erro): guarde e mande em /nfe/consultar',
          },
        },
        resposta_rejeicao: {
          status: 422,
          body: {
            success: false,
            status: 'rejeitado',
            codigoStatus: 'string — Código de rejeição SEFAZ',
            motivoStatus: 'string — Descrição da rejeição',
            chaveAcesso: 'string',
            erros: ['string — Detalhes do erro'],
          },
        },
        resposta_validacao: {
          status: 400,
          body: {
            error: 'string — Descrição do campo ausente/inválido',
          },
        },
      },

      {
        method: 'POST',
        path: '/nfe/nfce/emitir',
        descricao: 'Emite uma Nota Fiscal de Consumidor Eletrônica (modelo 65). Similar à NFe mas para varejo/consumidor final. Requer CSC (Código de Segurança do Contribuinte) ao invés de destinatário completo.',
        autenticacao: true,
        request_body: {
          emitente: 'object — Mesmo formato da NFe (OBRIGATÓRIO)',
          consumidor: {
            _tipo: 'object — Opcional (NFCe pode ser sem identificação)',
            cpf: 'string',
            cnpj: 'string',
            nome: 'string',
          },
          itens: 'array — Mesmo formato da NFe (OBRIGATÓRIO)',
          pagamento: 'object — Mesmo formato da NFe (OBRIGATÓRIO)',
          transporte: 'object — Mesmo formato da NFe',
          csc: {
            _tipo: 'object — OBRIGATÓRIO (específico da NFCe)',
            id: 'string — ID do CSC (fornecido pela SEFAZ estadual)',
            token: 'string — Token do CSC',
          },
          certificado: {
            pfxBase64: 'string — OBRIGATÓRIO',
            password: 'string — OBRIGATÓRIO',
          },
          serie: "string — Série (default '1')",
          numero: 'number — OBRIGATÓRIO (>= 1)',
          ufEmitente: 'string — OBRIGATÓRIO',
          informacoesAdicionais: { contribuinte: 'string — Opcional' },
        },
        resposta_sucesso: 'Mesmo formato da NFe (status 200)',
        resposta_rejeicao: 'Mesmo formato da NFe (status 422)',
      },

      {
        method: 'POST',
        path: '/nfe/consultar',
        descricao: 'Consulta a situação atual de uma NFe/NFCe na SEFAZ pela chave de acesso. Nota cancelada volta com status cancelado, o cStat da consulta (101/151/155) e o XML do cancelamento. Com o xmlAssinado de uma emissão incerta, a nota autorizada ou denegada volta com o nfeProc.',
        autenticacao: true,
        request_body: {
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          xmlAssinado: 'string — Opcional: o xmlAssinado devolvido pela emissão incerta (processando/erro)',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
          ufEmitente: 'string — OBRIGATÓRIO',
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: 'boolean — true só para autorizada',
            status: "'autorizado' | 'cancelado' | 'denegado'",
            codigoStatus: 'string — na cancelada, o cStat da consulta (101/151/155)',
            motivoStatus: 'string',
            chaveAcesso: 'string — 44 dígitos',
            protocolo: 'string — o da autorização',
            dataRecebimento: 'string — ISO 8601',
            xml: 'string — nfeProc, quando o xmlAssinado veio e confere com o protocolo',
            xmlCancelamento: 'string — procEventoNFe do cancelamento, na nota cancelada',
          },
        },
      },

      {
        method: 'POST',
        path: '/nfe/cancelar',
        descricao: 'Cancela uma NFe/NFCe previamente autorizada. O cancelamento deve ocorrer dentro do prazo legal (geralmente 24h).',
        autenticacao: true,
        request_body: {
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          protocolo: 'string — OBRIGATÓRIO, protocolo de autorização original',
          justificativa: 'string — OBRIGATÓRIO, 15 a 255 caracteres',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
          ufEmitente: 'string — OBRIGATÓRIO',
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '135',
            motivoStatus: 'Evento registrado e vinculado a NF-e',
            chaveAcesso: 'string',
            protocolo: 'string — Protocolo do evento de cancelamento',
            xml: 'string — procEventoNFe (evento assinado + retEvento), para guardar 5 anos',
          },
        },
        validacoes: [
          'chaveAcesso deve ter exatamente 44 dígitos numéricos',
          'justificativa deve ter entre 15 e 255 caracteres',
          'protocolo de autorização original é obrigatório',
        ],
      },

      {
        method: 'POST',
        path: '/nfe/carta-correcao',
        descricao: 'Emite uma Carta de Correção Eletrônica (CC-e) para corrigir dados de uma NFe autorizada. Não permite alterar valores, CFOP, ou dados que alterem o cálculo do imposto.',
        autenticacao: true,
        request_body: {
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          correcao: 'string — OBRIGATÓRIO, 15 a 1000 caracteres, texto da correção',
          sequencia: 'number — Opcional (default 1), número sequencial do evento',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
          ufEmitente: 'string — OBRIGATÓRIO',
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '135',
            motivoStatus: 'Evento registrado e vinculado a NF-e',
            protocolo: 'string',
            xml: 'string — procEventoNFe da CC-e',
          },
        },
      },

      {
        method: 'POST',
        path: '/nfe/inutilizar',
        descricao: 'Inutiliza uma faixa de numeração de NFe que foi pulada (ex: números 10 a 15 não utilizados). Obrigatório quando há quebra na sequência numérica.',
        autenticacao: true,
        request_body: {
          cnpj: 'string — OBRIGATÓRIO',
          serie: 'string — OBRIGATÓRIO',
          numeroInicial: 'number — OBRIGATÓRIO',
          numeroFinal: 'number — OBRIGATÓRIO',
          justificativa: 'string — OBRIGATÓRIO, 15 a 255 caracteres',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '102',
            motivoStatus: 'string',
            protocolo: 'string',
            xml: 'string — procInutNFe (pedido assinado + retInutNFe), para guardar 5 anos',
          },
        },
      },

      {
        method: 'POST',
        path: '/nfe/dfe/distribuicao',
        descricao: 'Uma página (até 50 documentos) da Distribuição DF-e do Ambiente Nacional: as NF-e e os eventos em que o CNPJ aparece (compras, sobretudo). Sem estado: o cliente guarda o NSU. Peça a partir do ultNSU devolvido; quando ultNSU alcança maxNSU, só volte depois de 1 hora. 656 (consumo indevido) = esperar 1 hora. Resposta com status erro: não avance o NSU.',
        autenticacao: true,
        request_body: {
          cnpj: 'string — OBRIGATÓRIO, o do destinatário (o do certificado)',
          ufAutor: 'string — OBRIGATÓRIO, sigla ("RS") ou código IBGE ("43") da UF do interessado',
          ultNSU: 'string|number — o último NSU já lido (0 ou ausente = desde o início)',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: "'ok' | 'consumo_indevido' | 'rejeitado' | 'erro'",
            codigoStatus: "'138' (há documentos) | '137' (nenhum) | '656'",
            motivoStatus: 'string',
            ultNSU: 'string — 15 dígitos; vazio quando a resposta não o trouxe',
            maxNSU: 'string — 15 dígitos',
            documentos: [{
              nsu: 'string — 15 dígitos',
              schema: 'string — ex.: resNFe_v1.01.xsd',
              tipo: "'resNFe' | 'procNFe' | 'resEvento' | 'procEventoNFe' | 'outro'",
              chaveAcesso: 'string',
              xml: 'string — descompactado',
            }],
          },
        },
      },

      {
        method: 'POST',
        path: '/nfe/dfe/consulta-chave',
        descricao: 'Os documentos DF-e de uma chave: a nota completa (procNFe) se o destinatário já deu ciência; senão o resumo (resNFe).',
        autenticacao: true,
        request_body: {
          cnpj: 'string — OBRIGATÓRIO',
          ufAutor: 'string — OBRIGATÓRIO',
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: 'Mesmo formato de /nfe/dfe/distribuicao',
      },

      {
        method: 'POST',
        path: '/nfe/manifestacao',
        descricao: 'Manifestação do Destinatário no Ambiente Nacional: ciencia (210210, libera o XML completo), confirmacao (210200), desconhecimento (210220), nao_realizada (210240, com justificativa). 573 = já manifestado.',
        autenticacao: true,
        request_body: {
          cnpj: 'string — OBRIGATÓRIO, o do destinatário',
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          tipo: "'ciencia' | 'confirmacao' | 'desconhecimento' | 'nao_realizada'",
          justificativa: 'string — 15 a 255 caracteres, só na nao_realizada',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '135',
            protocolo: 'string',
            xml: 'string — procEventoNFe da manifestação',
          },
        },
      },

      {
        method: 'POST',
        path: '/nfe/status',
        descricao: 'Consulta o status do serviço da SEFAZ (se está online/operacional). Útil para verificar disponibilidade antes de emitir.',
        autenticacao: true,
        request_body: {
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
          ufEmitente: 'string — OBRIGATÓRIO',
          modelo: "'55' | '65' — Opcional (55=NFe, 65=NFCe)",
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '107',
            motivoStatus: 'Serviço em operação',
          },
        },
      },
    ],

    mdfe: [
      {
        method: 'POST',
        path: '/mdfe/emitir',
        descricao: 'Emite um Manifesto Eletrônico de Documentos Fiscais (MDF-e) para transporte rodoviário. Vincula NFes a um veículo/condutor para fiscalização de trânsito.',
        autenticacao: true,
        request_body: {
          emitente: {
            _tipo: 'object — OBRIGATÓRIO',
            cnpj: 'string — CNPJ do emitente',
            inscricaoEstadual: 'string',
            nome: 'string — Razão social',
            nomeFantasia: 'string — Opcional',
            endereco: 'object — Mesmo formato do emitente da NFe',
          },
          modal: "'rodoviario' — OBRIGATÓRIO (único modal suportado)",
          tpEmit: "'1' | '2' — Opcional (1=Prestador de serviço, 2=Carga própria, default '2')",
          tpTransp: "'1' | '2' | '3' — Opcional (válido quando tpEmit='1')",
          ufInicio: 'string — OBRIGATÓRIO, sigla UF de início do transporte',
          ufFim: 'string — OBRIGATÓRIO, sigla UF de fim do transporte',
          municipiosCarregamento: {
            _tipo: 'array — OBRIGATÓRIO, mínimo 1',
            _exemplo: {
              codigoMunicipio: 'string — Código IBGE',
              nome: 'string — Nome do município',
            },
          },
          percurso: 'array de strings — Opcional, UFs intermediárias do percurso',
          descargas: {
            _tipo: 'array — OBRIGATÓRIO, mínimo 1',
            _exemplo: {
              codigoMunicipio: 'string — Código IBGE do município de descarga',
              nomeMunicipio: 'string',
              chaves: 'array de strings — Chaves de acesso das NFes vinculadas (44 dígitos cada)',
            },
          },
          veiculo: {
            _tipo: 'object — OBRIGATÓRIO',
            placa: 'string — Placa do veículo',
            renavam: 'string — Opcional',
            tara: 'number — Peso do veículo vazio em KG',
            capKG: 'number — Capacidade em KG (opcional)',
            capM3: 'number — Capacidade em M³ (opcional)',
            tipoRodado: "'01'=Truck, '02'=Toco, '03'=Cavalo mecânico, '04'=VAN, '05'=Utilitário, '06'=Outros",
            tipoCarroceria: "'00'=Não aplicável, '01'=Aberta, '02'=Fechada baú, '03'=Granelera, '04'=Porta container, '05'=Sider",
            uf: 'string — UF de licenciamento',
            rntrc: 'string — RNTRC (opcional)',
          },
          reboques: 'array — Opcional, mesmo formato do veículo',
          condutores: {
            _tipo: 'array — OBRIGATÓRIO, mínimo 1',
            _exemplo: {
              nome: 'string — Nome do condutor',
              cpf: 'string — CPF do condutor',
            },
          },
          produtoPredominante: {
            _tipo: 'object — OBRIGATÓRIO',
            tipoCarga: "string — '01' a '12' (01=Granel sólido, 02=Granel líquido, etc.)",
            descricao: 'string — Descrição da carga',
            cean: 'string — Opcional',
            ncm: 'string — Opcional',
          },
          valorTotalCarga: 'number — OBRIGATÓRIO, valor total da carga em R$',
          codigoUnidadePeso: "'01' | '02' — 01=KG, 02=TON",
          pesoBrutoTotal: 'number — OBRIGATÓRIO',
          seguro: {
            _tipo: 'object — Opcional',
            responsavel: "'1' | '2' — 1=Emitente, 2=Contratante",
            cnpjResponsavel: 'string',
            nomeSeguradora: 'string',
            numeroApolice: 'string',
            numeroAverbacao: 'array de strings',
          },
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
          serie: "string — Opcional (default '1')",
          numero: 'number — OBRIGATÓRIO (>= 1)',
          informacoesAdicionais: 'string — Opcional',
          informacoesFisco: 'string — Opcional',
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '100',
            motivoStatus: 'Autorizado o uso do MDF-e',
            chaveAcesso: 'string — 44 dígitos',
            protocolo: 'string',
            dataRecebimento: 'string — ISO 8601',
            xml: 'string — XML assinado com protocolo',
          },
        },
      },

      {
        method: 'POST',
        path: '/mdfe/consultar',
        descricao: 'Consulta a situação atual de um MDF-e na SEFAZ.',
        autenticacao: true,
        request_body: {
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'string',
            codigoStatus: 'string',
            motivoStatus: 'string',
            chaveAcesso: 'string',
            protocolo: 'string',
          },
        },
      },

      {
        method: 'POST',
        path: '/mdfe/encerrar',
        descricao: 'Encerra um MDF-e após a conclusão do transporte. Obrigatório para liberar o veículo para novo MDF-e.',
        autenticacao: true,
        request_body: {
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          protocolo: 'string — OBRIGATÓRIO, protocolo de autorização',
          codigoMunicipio: 'string — OBRIGATÓRIO, código IBGE do município de encerramento',
          uf: 'string — OBRIGATÓRIO, UF de encerramento',
          dataEncerramento: 'string — Opcional (YYYY-MM-DD, default hoje)',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '135',
            motivoStatus: 'Evento registrado e vinculado ao MDF-e',
            protocolo: 'string',
          },
        },
      },

      {
        method: 'POST',
        path: '/mdfe/cancelar',
        descricao: 'Cancela um MDF-e autorizado. Deve ser feito antes do início do transporte.',
        autenticacao: true,
        request_body: {
          chaveAcesso: 'string — OBRIGATÓRIO, 44 dígitos',
          protocolo: 'string — OBRIGATÓRIO',
          justificativa: 'string — OBRIGATÓRIO, 15 a 255 caracteres',
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '135',
            motivoStatus: 'Evento registrado e vinculado ao MDF-e',
            protocolo: 'string',
          },
        },
      },

      {
        method: 'POST',
        path: '/mdfe/status',
        descricao: 'Consulta o status do serviço MDF-e na SEFAZ.',
        autenticacao: true,
        request_body: {
          certificado: { pfxBase64: 'string — OBRIGATÓRIO', password: 'string — OBRIGATÓRIO' },
        },
        resposta_sucesso: {
          status: 200,
          body: {
            success: true,
            status: 'autorizado',
            codigoStatus: '107',
            motivoStatus: 'Serviço em operação',
          },
        },
      },
    ],

    metricas: [
      {
        method: 'GET',
        path: '/api/metrics/health',
        descricao: 'Status de saúde do sistema com métricas de uptime, memória e taxa de sucesso.',
        autenticacao: true,
      },
      {
        method: 'GET',
        path: '/api/metrics/performance',
        descricao: 'Métricas de performance: tempos de resposta, throughput por endpoint.',
        autenticacao: true,
      },
      {
        method: 'GET',
        path: '/api/metrics/emissions',
        descricao: 'Estatísticas de emissões (NFe/NFCe) por período (hoje, semana, mês).',
        autenticacao: true,
      },
      {
        method: 'GET',
        path: '/api/metrics/errors',
        descricao: 'Erros recentes e taxas de erro por categoria.',
        autenticacao: true,
      },
      {
        method: 'POST',
        path: '/api/metrics/reset',
        descricao: 'Reseta todas as métricas acumuladas.',
        autenticacao: true,
      },
    ],
  },

  codigos_uf: {
    descricao: 'Códigos IBGE das UFs brasileiras (usar no campo ufEmitente)',
    valores: {
      '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
      '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
      '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
      '41': 'PR', '42': 'SC', '43': 'RS',
      '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
    },
  },

  erros_comuns: {
    descricao: 'Códigos de rejeição frequentes da SEFAZ e como resolver',
    lista: [
      { codigo: '204', descricao: 'Duplicidade de NF-e', solucao: 'A chave de acesso já existe. Verificar se a NF já foi emitida ou alterar o número.' },
      { codigo: '206', descricao: 'NF-e já está inutilizada', solucao: 'Não é possível emitir com este número. Use o próximo número disponível.' },
      { codigo: '217', descricao: 'CNPJ do destinatário inválido', solucao: 'Verificar o CNPJ do destinatário (dígitos verificadores).' },
      { codigo: '225', descricao: 'Falha no Schema XML', solucao: 'Campos obrigatórios ausentes ou com formato inválido. Verificar o payload enviado.' },
      { codigo: '233', descricao: 'IE do destinatário não cadastrada', solucao: 'Verificar a inscrição estadual do destinatário junto à SEFAZ do estado.' },
      { codigo: '301', descricao: 'Uso Denegado: Irregularidade fiscal do emitente', solucao: 'Situação fiscal do emitente está irregular. Contatar contador.' },
      { codigo: '302', descricao: 'Uso Denegado: Irregularidade fiscal do destinatário', solucao: 'Situação fiscal do destinatário está irregular.' },
      { codigo: '539', descricao: 'Duplicidade de evento', solucao: 'Este evento (cancelamento/CC-e) já foi registrado para esta NF-e.' },
      { codigo: '501', descricao: 'Prazo de cancelamento expirado', solucao: 'O prazo para cancelamento expirou (geralmente 24h). Emitir NF de devolução/estorno.' },
    ],
  },

  fluxo_integracao: {
    descricao: 'Passo a passo para integrar com a API',
    passos: [
      '1. OBTER CREDENCIAIS: Solicite o token de autenticação (API Key) ao administrador.',
      '2. CERTIFICADO DIGITAL: Obtenha um certificado A1 (.pfx) válido junto a uma Autoridade Certificadora (AC). Converta para base64 para enviar nas requisições.',
      '3. VERIFICAR STATUS: Antes de emitir, chame POST /nfe/status para verificar se a SEFAZ está operacional.',
      '4. EMITIR DOCUMENTO: Envie o payload completo para POST /nfe/emitir (ou /nfe/nfce/emitir para NFCe, /mdfe/emitir para MDF-e).',
      '5. PROCESSAR RESPOSTA: Se success=true, armazene o XML retornado, a chaveAcesso e o protocolo. Se success=false, analise o codigoStatus e os erros.',
      '6. CONSULTAR (se necessário): Use POST /nfe/consultar com a chaveAcesso para verificar o status atual.',
      '7. CANCELAR (se necessário): Use POST /nfe/cancelar dentro do prazo legal, informando justificativa com no mínimo 15 caracteres.',
      '8. CARTA DE CORREÇÃO (se necessário): Use POST /nfe/carta-correcao para corrigir dados sem alterar valores.',
    ],
  },

  exemplo_minimo_nfe: {
    descricao: 'Exemplo mínimo de emissão de NFe (venda simples, Simples Nacional)',
    nota: 'Este é um exemplo simplificado. Ajuste os valores fiscais conforme sua situação tributária.',
    request: {
      method: 'POST',
      url: '/nfe/emitir',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {SEU_TOKEN}',
      },
      body: {
        emitente: {
          cnpj: '12345678000195',
          nome: 'EMPRESA EXEMPLO LTDA',
          nomeFantasia: 'EXEMPLO',
          inscricaoEstadual: '123456789',
          crt: '1',
          endereco: {
            logradouro: 'Rua Exemplo',
            numero: '100',
            bairro: 'Centro',
            codigoMunicipio: '3550308',
            municipio: 'Sao Paulo',
            uf: 'SP',
            cep: '01001000',
          },
        },
        destinatario: {
          cpf: '12345678901',
          nome: 'CONSUMIDOR TESTE',
          indicadorIE: '9',
          endereco: {
            logradouro: 'Av Teste',
            numero: '200',
            bairro: 'Jardim',
            codigoMunicipio: '3550308',
            municipio: 'Sao Paulo',
            uf: 'SP',
            cep: '01002000',
          },
        },
        itens: [
          {
            numero: 1,
            produto: {
              codigo: 'PROD001',
              cEAN: 'SEM GTIN',
              descricao: 'PRODUTO EXEMPLO',
              ncm: '94013000',
              cfop: '5102',
              unidade: 'UN',
              quantidade: 1,
              valorUnitario: 100.00,
              valorTotal: 100.00,
              cEANTrib: 'SEM GTIN',
              unidadeTrib: 'UN',
              quantidadeTrib: 1,
              valorUnitarioTrib: 100.00,
              indTot: '1',
            },
            imposto: {
              icms: {
                orig: '0',
                csosn: '102',
              },
              pis: { cst: '49' },
              cofins: { cst: '49' },
            },
          },
        ],
        naturezaOperacao: 'VENDA DE MERCADORIA',
        tipoOperacao: '1',
        finalidade: '1',
        consumidorFinal: '1',
        presencaComprador: '1',
        transporte: { modFrete: '9' },
        pagamento: {
          indicadorPagamento: '0',
          formas: [{ tipo: '01', valor: 100.00 }],
        },
        certificado: {
          pfxBase64: '{CERTIFICADO_PFX_EM_BASE64}',
          password: '{SENHA_DO_CERTIFICADO}',
        },
        serie: '1',
        numero: 1,
        ufEmitente: '35',
      },
    },
  },

  exemplo_minimo_nfce: {
    descricao: 'Exemplo mínimo de emissão de NFCe (venda ao consumidor)',
    request: {
      method: 'POST',
      url: '/nfe/nfce/emitir',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer {SEU_TOKEN}',
      },
      body: {
        emitente: {
          cnpj: '12345678000195',
          nome: 'EMPRESA EXEMPLO LTDA',
          inscricaoEstadual: '123456789',
          crt: '1',
          endereco: {
            logradouro: 'Rua Exemplo',
            numero: '100',
            bairro: 'Centro',
            codigoMunicipio: '3550308',
            municipio: 'Sao Paulo',
            uf: 'SP',
            cep: '01001000',
          },
        },
        itens: [
          {
            numero: 1,
            produto: {
              codigo: 'PROD001',
              cEAN: 'SEM GTIN',
              descricao: 'PRODUTO EXEMPLO',
              ncm: '94013000',
              cfop: '5102',
              unidade: 'UN',
              quantidade: 1,
              valorUnitario: 50.00,
              valorTotal: 50.00,
              cEANTrib: 'SEM GTIN',
              unidadeTrib: 'UN',
              quantidadeTrib: 1,
              valorUnitarioTrib: 50.00,
              indTot: '1',
            },
            imposto: {
              icms: { orig: '0', csosn: '102' },
              pis: { cst: '49' },
              cofins: { cst: '49' },
            },
          },
        ],
        pagamento: {
          indicadorPagamento: '0',
          formas: [{ tipo: '17', valor: 50.00 }],
        },
        transporte: { modFrete: '9' },
        csc: {
          id: '{SEU_CSC_ID}',
          token: '{SEU_CSC_TOKEN}',
        },
        certificado: {
          pfxBase64: '{CERTIFICADO_PFX_EM_BASE64}',
          password: '{SENHA_DO_CERTIFICADO}',
        },
        serie: '1',
        numero: 1,
        ufEmitente: '35',
      },
    },
  },

  notas_para_agentes_ia: {
    descricao: 'Instruções específicas para agentes de IA consumindo esta API',
    instrucoes: [
      'TODOS os endpoints fiscais usam método POST e recebem JSON no body.',
      'O campo certificado (pfxBase64 + password) é obrigatório em TODAS as requisições fiscais.',
      'Campos numéricos de valores monetários devem usar ponto como separador decimal (ex: 100.50, não 100,50).',
      'CPF tem 11 dígitos, CNPJ tem 14 dígitos — enviar apenas números, sem formatação.',
      'A chave de acesso (chaveAcesso) tem exatamente 44 dígitos numéricos.',
      'O campo ufEmitente usa o código IBGE numérico (ex: "35" para SP), não a sigla.',
      'Para Simples Nacional (CRT 1 ou 2), use csosn no ICMS. Para Regime Normal (CRT 3), use cst.',
      'O valorTotal do produto DEVE ser igual a quantidade × valorUnitario.',
      'Se success=false na resposta, leia codigoStatus e erros[] para diagnóstico.',
      'Antes de emitir, verifique o status da SEFAZ com POST /nfe/status.',
      'Armazene o XML retornado em emissões autorizadas — é obrigatório por lei manter por 5 anos.',
      'A API não armazena certificados ou documentos — o chamador é responsável pelo armazenamento.',
      'Em ambiente de homologação, use CNPJ/CPF fictícios e o nome do destinatário deve conter "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL".',
    ],
  },
};

router.get('/', (_req: Request, res: Response) => {
  res.json(documentation);
});

export default router;
