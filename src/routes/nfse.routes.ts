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

// POST /nfse/emitir - Emitir NFS-e (RPS único)
router.post('/emitir', async (req: Request, res: Response) => {
  try {
    const data: NfseEmitirRequest = req.body;

    if (!data.prestador?.cnpj || !data.prestador?.inscricaoMunicipal) {
      res.status(400).json({ error: 'Campos obrigatórios: prestador.cnpj, prestador.inscricaoMunicipal' });
      return;
    }
    if (!data.tomador?.nome) {
      res.status(400).json({ error: 'Nome do tomador é obrigatório' });
      return;
    }
    if (!data.servico?.codigoServico || !data.servico?.discriminacao) {
      res.status(400).json({ error: 'Campos obrigatórios: servico.codigoServico, servico.discriminacao' });
      return;
    }
    if (!data.valores?.valorServicos || data.valores.valorServicos <= 0) {
      res.status(400).json({ error: 'valores.valorServicos deve ser maior que zero' });
      return;
    }
    if (!data.rps?.numero || !data.rps?.serie) {
      res.status(400).json({ error: 'Campos obrigatórios: rps.numero, rps.serie' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
      return;
    }

    const result = await nfseService.emitirNfse(data);
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
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
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
