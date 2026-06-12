import { Router, Request, Response } from 'express';
import * as mdfeService from '../services/mdfe.service';
import { validarCNPJ, validarCPF, validarChaveAcesso, parsePfx, certCnpjBate } from '../lib/utils';
import { config } from '../config';
import type {
  MdfeRequest,
  MdfeEncerrarRequest,
  MdfeCancelarRequest,
  MdfeIncluirCondutorRequest,
  CertificateData,
} from '../types';

const router = Router();

function certMismatch(res: Response, certificado: CertificateData, emitenteCnpj: string): boolean {
  let parsed: ReturnType<typeof parsePfx>;
  try {
    parsed = parsePfx(certificado.pfxBase64, certificado.password);
  } catch (err: any) {
    res.status(400).json({ error: `Certificado inválido: ${err.message || 'não foi possível decodificar o PFX'}` });
    return true;
  }
  if (parsed.notAfter.getTime() < Date.now()) {
    res.status(400).json({ error: `Certificado expirado em ${parsed.notAfter.toISOString()}` });
    return true;
  }
  if (config.validateCertCnpj && !certCnpjBate(parsed.cnpj, emitenteCnpj)) {
    res.status(403).json({
      error: 'CNPJ do certificado não corresponde ao CNPJ do emitente informado no payload',
    });
    return true;
  }
  return false;
}

// POST /mdfe/emitir - Emitir MDF-e
router.post('/emitir', async (req: Request, res: Response) => {
  try {
    const data: MdfeRequest = req.body;

    if (!data.emitente?.cnpj) {
      res.status(400).json({ error: 'emitente.cnpj é obrigatório' });
      return;
    }
    if (!validarCNPJ(data.emitente.cnpj)) {
      res.status(400).json({ error: 'CNPJ do emitente inválido (DV incorreto)' });
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
    if (certMismatch(res, data.certificado, data.emitente.cnpj)) return;

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

    if (!chaveAcesso || !validarChaveAcesso(chaveAcesso)) {
      res.status(400).json({ error: 'chaveAcesso inválida (44 dígitos + DV módulo 11)' });
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

    if (!data.chaveAcesso || !validarChaveAcesso(data.chaveAcesso)) {
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
    if (certMismatch(res, data.certificado, data.chaveAcesso.substring(6, 20))) return;

    const result = await mdfeService.encerrarMdfe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[MDF-e] Erro ao encerrar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /mdfe/incluir-condutor - Incluir condutor (evento 110114)
router.post('/incluir-condutor', async (req: Request, res: Response) => {
  try {
    const data: MdfeIncluirCondutorRequest = req.body;

    if (!data.chaveAcesso || !validarChaveAcesso(data.chaveAcesso)) {
      res.status(400).json({ error: 'chaveAcesso (44 dígitos) é obrigatória' });
      return;
    }
    if (!data.condutor?.nome || !data.condutor?.cpf) {
      res.status(400).json({ error: 'condutor (nome + cpf) é obrigatório' });
      return;
    }
    if (!validarCPF(data.condutor.cpf)) {
      res.status(400).json({ error: 'CPF do condutor inválido (DV incorreto)' });
      return;
    }
    if (data.nSeqEvento !== undefined && (data.nSeqEvento < 1 || data.nSeqEvento > 99)) {
      res.status(400).json({ error: 'nSeqEvento deve estar entre 1 e 99' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }
    if (certMismatch(res, data.certificado, data.chaveAcesso.substring(6, 20))) return;

    const result = await mdfeService.incluirCondutorMdfe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[MDF-e] Erro ao incluir condutor:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /mdfe/cancelar - Cancelar MDF-e
router.post('/cancelar', async (req: Request, res: Response) => {
  try {
    const data: MdfeCancelarRequest = req.body;

    if (!data.chaveAcesso || !validarChaveAcesso(data.chaveAcesso)) {
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
    if (certMismatch(res, data.certificado, data.chaveAcesso.substring(6, 20))) return;

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
