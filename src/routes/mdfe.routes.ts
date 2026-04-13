import { Router, Request, Response } from 'express';
import * as mdfeService from '../services/mdfe.service';
import type {
  MdfeRequest,
  MdfeEncerrarRequest,
  MdfeCancelarRequest,
  CertificateData,
} from '../types';

const router = Router();

// POST /mdfe/emitir - Emitir MDF-e
router.post('/emitir', async (req: Request, res: Response) => {
  try {
    const data: MdfeRequest = req.body;

    if (!data.emitente?.cnpj) {
      res.status(400).json({ error: 'emitente.cnpj é obrigatório' });
      return;
    }
    if (!data.ufInicio || !data.ufFim) {
      res.status(400).json({ error: 'ufInicio e ufFim são obrigatórios' });
      return;
    }
    if (!data.municipiosCarregamento?.length) {
      res.status(400).json({ error: 'Pelo menos um município de carregamento é obrigatório' });
      return;
    }
    if (!data.veiculo?.placa) {
      res.status(400).json({ error: 'veiculo.placa é obrigatório' });
      return;
    }
    if (!data.condutores?.length) {
      res.status(400).json({ error: 'Pelo menos um condutor é obrigatório' });
      return;
    }
    if (!data.descargas?.length) {
      res.status(400).json({ error: 'Pelo menos uma descarga é obrigatória' });
      return;
    }
    if (!data.produtoPredominante?.tipoCarga || !data.produtoPredominante?.descricao) {
      res.status(400).json({ error: 'produtoPredominante (tipoCarga + descricao) é obrigatório' });
      return;
    }
    if (data.valorTotalCarga === undefined || data.pesoBrutoTotal === undefined) {
      res.status(400).json({ error: 'valorTotalCarga e pesoBrutoTotal são obrigatórios' });
      return;
    }
    if (!data.numero || data.numero < 1) {
      res.status(400).json({ error: 'numero do MDF-e é obrigatório (sequencial, controlado pelo emissor)' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
      return;
    }

    const result = await mdfeService.emitirMdfe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[MDF-e] Erro ao emitir:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /mdfe/consultar - Consultar MDF-e
router.post('/consultar', async (req: Request, res: Response) => {
  try {
    const { chaveAcesso, certificado, ambiente } = req.body as {
      chaveAcesso: string;
      certificado: CertificateData;
      ambiente?: 'producao' | 'homologacao';
    };

    if (!chaveAcesso || chaveAcesso.length !== 44) {
      res.status(400).json({ error: 'chaveAcesso (44 dígitos) é obrigatória' });
      return;
    }
    if (!certificado?.pfxBase64 || !certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await mdfeService.consultarMdfe(chaveAcesso, certificado, ambiente);
    res.json(result);
  } catch (err: any) {
    console.error('[MDF-e] Erro ao consultar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /mdfe/encerrar - Encerrar MDF-e
router.post('/encerrar', async (req: Request, res: Response) => {
  try {
    const data: MdfeEncerrarRequest = req.body;

    if (!data.chaveAcesso || data.chaveAcesso.length !== 44) {
      res.status(400).json({ error: 'chaveAcesso (44 dígitos) é obrigatória' });
      return;
    }
    if (!data.protocolo) {
      res.status(400).json({ error: 'protocolo de autorização é obrigatório' });
      return;
    }
    if (!data.codigoMunicipio || !data.uf) {
      res.status(400).json({ error: 'codigoMunicipio e uf são obrigatórios' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await mdfeService.encerrarMdfe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[MDF-e] Erro ao encerrar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /mdfe/cancelar - Cancelar MDF-e
router.post('/cancelar', async (req: Request, res: Response) => {
  try {
    const data: MdfeCancelarRequest = req.body;

    if (!data.chaveAcesso || data.chaveAcesso.length !== 44) {
      res.status(400).json({ error: 'chaveAcesso (44 dígitos) é obrigatória' });
      return;
    }
    if (!data.protocolo) {
      res.status(400).json({ error: 'protocolo de autorização é obrigatório' });
      return;
    }
    if (!data.justificativa || data.justificativa.length < 15 || data.justificativa.length > 255) {
      res.status(400).json({ error: 'justificativa deve ter entre 15 e 255 caracteres' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await mdfeService.cancelarMdfe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[MDF-e] Erro ao cancelar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /mdfe/status - Status do serviço SEFAZ MDF-e
router.post('/status', async (req: Request, res: Response) => {
  try {
    const { certificado, ambiente } = req.body as { certificado: CertificateData; ambiente?: 'producao' | 'homologacao' };

    if (!certificado?.pfxBase64 || !certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }

    const result = await mdfeService.statusServico(certificado, ambiente);
    res.json(result);
  } catch (err: any) {
    console.error('[MDF-e] Erro ao consultar status:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

export default router;
