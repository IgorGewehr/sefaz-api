import { Router, Request, Response } from 'express';
import * as nfseService from '../services/nfse.service';
import type {
  NfseEmitirRequest,
  NfseEnviarLoteRequest,
  NfseConsultarLoteRequest,
  NfseConsultarNfseRequest,
  NfseCancelarRequest,
} from '../types/nfse';

const router = Router();

// ---------------------------------------------------------------------------
// Normaliza o payload recebido (novo formato DPS ou formato legado rps.*)
// Novo formato: { numeroDPS, serie, codigoMunicipioEmissao, servico.localPrestacao, issqn }
// Legado:       { rps.numero, rps.serie, servico.codigoMunicipioPrestacao, valores.aliquotaIss }
// ---------------------------------------------------------------------------
function normalizeEmitirRequest(body: any): NfseEmitirRequest {
  const codigoMunicipio =
    body.codigoMunicipioEmissao ||
    body.servico?.localPrestacao?.codigoMunicipio ||
    body.servico?.codigoMunicipioPrestacao ||
    '';

  const isSimples =
    body.prestador?.simplesNacional === '1' ||
    body.prestador?.optanteSimplesNacional === true;

  // Código de serviço: novo formato usa codigoTributacaoNacional, legado usa codigoServico
  const codigoServico =
    body.servico?.codigoServico ||
    body.servico?.codigoTributacaoNacional ||
    '';

  // ISS: novo formato usa objeto issqn, legado usa valores.*
  const aliquotaIss = body.issqn
    ? (Number(body.issqn.aliquota) / 100)          // issqn.aliquota é percentual (ex: 5 → 0.05)
    : (body.valores?.aliquotaIss ?? 0);
  const issRetido = body.issqn
    ? body.issqn.tipoRetencaoISSQN !== '1'
    : (body.valores?.issRetido ?? false);

  return {
    prestador: {
      ...body.prestador,
      optanteSimplesNacional: isSimples,
    },
    tomador: body.tomador,
    servico: {
      codigoServico,
      codigoTributacaoNacional: body.servico?.codigoTributacaoNacional,
      codigoTributacaoMunicipio: body.servico?.codigoTributacaoMunicipal,
      discriminacao: body.servico?.discriminacao || '',
      codigoMunicipioPrestacao: codigoMunicipio,
      cnae: body.servico?.cnae,
      nbs: body.servico?.nbs,
    },
    valores: {
      valorServicos: body.valores?.valorServicos ?? 0,
      aliquotaIss,
      issRetido,
      exigibilidadeIss: body.valores?.exigibilidadeIss || '1',
      valorDeducoes: body.valores?.valorDeducoes,
      descontoIncondicionado: body.valores?.valorDescontoIncondicionado,
    },
    rps: {
      numero: body.numeroDPS ?? body.rps?.numero ?? 0,
      serie: body.serie ?? body.rps?.serie ?? '1',
      tipo: body.rps?.tipo ?? '1',
      dataEmissao: body.rps?.dataEmissao ?? new Date().toISOString().slice(0, 10),
      naturezaOperacao: body.rps?.naturezaOperacao ?? '1',
    },
    certificado: body.certificado,
    ambiente: body.ambiente,
    informacoesComplementares: body.informacoesComplementares,
  };
}

// POST /nfse/emitir - Emitir NFS-e (RPS único)
router.post('/emitir', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Validação — aceita novo formato (numeroDPS/codigoTributacaoNacional) e legado (rps.*/codigoServico)
    const cnpj = body.prestador?.cnpj;
    const im   = body.prestador?.inscricaoMunicipal;
    if (!cnpj || !im) {
      res.status(400).json({ error: 'Campos obrigatórios: prestador.cnpj, prestador.inscricaoMunicipal' });
      return;
    }
    if (!body.tomador?.nome) {
      res.status(400).json({ error: 'Nome do tomador é obrigatório' });
      return;
    }
    const codigoServico = body.servico?.codigoServico || body.servico?.codigoTributacaoNacional;
    if (!codigoServico || !body.servico?.discriminacao) {
      res.status(400).json({ error: 'Campos obrigatórios: servico.codigoServico (ou codigoTributacaoNacional), servico.discriminacao' });
      return;
    }
    if (!body.valores?.valorServicos || body.valores.valorServicos <= 0) {
      res.status(400).json({ error: 'valores.valorServicos deve ser maior que zero' });
      return;
    }
    const numeroDPS = body.numeroDPS ?? body.rps?.numero;
    const serie     = body.serie     ?? body.rps?.serie;
    if (!numeroDPS || !serie) {
      res.status(400).json({ error: 'Campos obrigatórios: numeroDPS (ou rps.numero) e serie (ou rps.serie)' });
      return;
    }
    const codigoMunicipio =
      body.codigoMunicipioEmissao ||
      body.servico?.localPrestacao?.codigoMunicipio ||
      body.servico?.codigoMunicipioPrestacao;
    if (!codigoMunicipio || String(codigoMunicipio).replace(/\D/g, '').length !== 7) {
      res.status(400).json({ error: 'codigoMunicipioEmissao é obrigatório (7 dígitos IBGE)' });
      return;
    }
    if (!body.certificado?.pfxBase64 || !body.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
      return;
    }

    const normalized = normalizeEmitirRequest(body);
    const result = await nfseService.emitirNfse(normalized);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFS-e] Erro ao emitir:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfse/lote - Enviar lote de RPS
router.post('/lote', async (req: Request, res: Response) => {
  try {
    const data: NfseEnviarLoteRequest = req.body;

    if (!data.prestador?.cnpj || !data.prestador?.inscricaoMunicipal) {
      res.status(400).json({ error: 'Campos obrigatórios: prestador.cnpj, prestador.inscricaoMunicipal' });
      return;
    }
    if (!data.rps || !Array.isArray(data.rps) || data.rps.length === 0) {
      res.status(400).json({ error: 'Lista de RPS é obrigatória e não pode ser vazia' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await nfseService.enviarLoteRps(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFS-e] Erro ao enviar lote:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfse/consultar-lote - Consultar lote de RPS
router.post('/consultar-lote', async (req: Request, res: Response) => {
  try {
    const data: NfseConsultarLoteRequest = req.body;

    if (!data.prestador?.cnpj || !data.prestador?.inscricaoMunicipal) {
      res.status(400).json({ error: 'Campos obrigatórios: prestador.cnpj, prestador.inscricaoMunicipal' });
      return;
    }
    if (!data.protocolo) {
      res.status(400).json({ error: 'Protocolo é obrigatório' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await nfseService.consultarLoteRps(data);
    res.json(result);
  } catch (err: any) {
    console.error('[NFS-e] Erro ao consultar lote:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfse/consultar - Consultar NFS-e
router.post('/consultar', async (req: Request, res: Response) => {
  try {
    const data: NfseConsultarNfseRequest = req.body;

    if (!data.prestador?.cnpj || !data.prestador?.inscricaoMunicipal) {
      res.status(400).json({ error: 'Campos obrigatórios: prestador.cnpj, prestador.inscricaoMunicipal' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await nfseService.consultarNfse(data);
    res.json(result);
  } catch (err: any) {
    console.error('[NFS-e] Erro ao consultar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfse/cancelar - Cancelar NFS-e
router.post('/cancelar', async (req: Request, res: Response) => {
  try {
    const data: NfseCancelarRequest = req.body;

    if (!data.prestador?.cnpj || !data.prestador?.inscricaoMunicipal) {
      res.status(400).json({ error: 'Campos obrigatórios: prestador.cnpj, prestador.inscricaoMunicipal' });
      return;
    }
    if (!data.numero) {
      res.status(400).json({ error: 'Número da NFS-e é obrigatório' });
      return;
    }
    if (!data.codigoMunicipio) {
      res.status(400).json({ error: 'Código do município é obrigatório' });
      return;
    }
    if (!data.codigoCancelamento || !['1', '2', '3', '4'].includes(data.codigoCancelamento)) {
      res.status(400).json({ error: 'Código de cancelamento inválido (1, 2, 3 ou 4)' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await nfseService.cancelarNfse(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFS-e] Erro ao cancelar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

export default router;
