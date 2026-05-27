import { Router, Request, Response } from 'express';
import * as nfeService from '../services/nfe.service';
import { validarCNPJ, validarCPF, validarChaveAcesso, parsePfx, certCnpjBate } from '../lib/utils';
import { config } from '../config';
import type { CertificateData } from '../types';
import type {
  NFeRequest,
  NFCeRequest,
  NFeCancelarRequest,
  NFeCartaCorrecaoRequest,
  NFeInutilizarRequest,
  NFeConsultaRequest,
  StatusServicoRequest,
} from '../types';

const router = Router();

/**
 * Retorna erro 400 se o CNPJ do certificado não bate com o CNPJ do emitente.
 * Também captura PFX inválido / senha errada com mensagem clara (evita 500 genérico).
 * Retorna `true` quando a checagem falhou (resposta já escrita).
 */
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

// POST /nfe/emitir - Emitir NFe
router.post('/emitir', async (req: Request, res: Response) => {
  try {
    const data: NFeRequest = req.body;

    if (!data.emitente?.cnpj || !data.destinatario || !data.itens?.length) {
      res.status(400).json({ error: 'Campos obrigatórios: emitente, destinatario, itens' });
      return;
    }
    if (!validarCNPJ(data.emitente.cnpj)) {
      res.status(400).json({ error: 'CNPJ do emitente inválido (DV incorreto)' });
      return;
    }
    if (data.destinatario.cnpj && !validarCNPJ(data.destinatario.cnpj)) {
      res.status(400).json({ error: 'CNPJ do destinatário inválido (DV incorreto)' });
      return;
    }
    if (data.destinatario.cpf && !validarCPF(data.destinatario.cpf)) {
      res.status(400).json({ error: 'CPF do destinatário inválido (DV incorreto)' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
      return;
    }
    if (!data.ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }
    if (!data.numero || data.numero < 1) {
      res.status(400).json({ error: 'numero da nota é obrigatório (sequencial, controlado pelo emissor)' });
      return;
    }
    if (certMismatch(res, data.certificado, data.emitente.cnpj)) return;

    const result = await nfeService.emitirNFe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFe] Erro ao emitir:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfce/emitir - Emitir NFCe
router.post('/nfce/emitir', async (req: Request, res: Response) => {
  try {
    const data: NFCeRequest = req.body;

    if (!data.emitente?.cnpj || !data.itens?.length) {
      res.status(400).json({ error: 'Campos obrigatórios: emitente, itens' });
      return;
    }
    if (!validarCNPJ(data.emitente.cnpj)) {
      res.status(400).json({ error: 'CNPJ do emitente inválido (DV incorreto)' });
      return;
    }
    if (data.consumidor?.cnpj && !validarCNPJ(data.consumidor.cnpj)) {
      res.status(400).json({ error: 'CNPJ do consumidor inválido (DV incorreto)' });
      return;
    }
    if (data.consumidor?.cpf && !validarCPF(data.consumidor.cpf)) {
      res.status(400).json({ error: 'CPF do consumidor inválido (DV incorreto)' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
      return;
    }
    if (!data.csc?.id || !data.csc?.token) {
      res.status(400).json({ error: 'CSC (id + token) é obrigatório para NFCe' });
      return;
    }
    if (!data.ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }
    if (!data.numero || data.numero < 1) {
      res.status(400).json({ error: 'numero da nota é obrigatório (sequencial, controlado pelo emissor)' });
      return;
    }
    if (certMismatch(res, data.certificado, data.emitente.cnpj)) return;

    const result = await nfeService.emitirNFCe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFCe] Erro ao emitir:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfce/contingencia/prepare - Gera XML assinado em contingência off-line
//   sem transmitir pra SEFAZ. Operador imprime DANFCE e armazena XML pra
//   transmissão posterior via /nfce/contingencia/transmit.
router.post('/nfce/contingencia/prepare', async (req: Request, res: Response) => {
  try {
    const data: NFCeRequest = req.body;

    if (!data.contingencia?.xJust) {
      res.status(400).json({ error: 'contingencia.xJust (justificativa, 15-256 caracteres) é obrigatório' });
      return;
    }
    if (!data.contingencia.dhCont) {
      res.status(400).json({ error: 'contingencia.dhCont (data/hora ISO de entrada em contingência) é obrigatório' });
      return;
    }
    if (!data.emitente?.cnpj || !data.itens?.length) {
      res.status(400).json({ error: 'Campos obrigatórios: emitente, itens' });
      return;
    }
    if (!validarCNPJ(data.emitente.cnpj)) {
      res.status(400).json({ error: 'CNPJ do emitente inválido (DV incorreto)' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
      return;
    }
    if (!data.csc?.id || !data.csc?.token) {
      res.status(400).json({ error: 'CSC (id + token) é obrigatório para NFCe' });
      return;
    }
    if (!data.ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }
    if (!data.numero || data.numero < 1) {
      res.status(400).json({ error: 'numero da nota é obrigatório' });
      return;
    }
    if (certMismatch(res, data.certificado, data.emitente.cnpj)) return;

    const result = await nfeService.prepararNFCeContingencia(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFCe Contingencia] Erro ao preparar:', err.message);
    res.status(500).json({ error: 'Erro interno ao preparar contingência' });
  }
});

// POST /nfce/contingencia/transmit - Envia XML já assinado (gerado por
//   /nfce/contingencia/prepare) pra SEFAZ. Use quando a SEFAZ voltar — em
//   até 24h após dhCont pra evitar rejeição por extemporaneidade.
router.post('/nfce/contingencia/transmit', async (req: Request, res: Response) => {
  try {
    const { signedXml, ufEmitente, certificado, ambiente } = req.body as {
      signedXml?: string;
      ufEmitente?: string;
      certificado?: CertificateData;
      ambiente?: 'producao' | 'homologacao';
    };

    if (!signedXml || typeof signedXml !== 'string') {
      res.status(400).json({ error: 'signedXml é obrigatório (XML assinado pelo prepare)' });
      return;
    }
    if (!ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }
    if (!certificado?.pfxBase64 || !certificado?.password) {
      res.status(400).json({ error: 'Certificado digital (pfxBase64 + password) é obrigatório' });
      return;
    }

    const result = await nfeService.transmitirNFCeContingencia(signedXml, ufEmitente, certificado, ambiente);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFCe Contingencia] Erro ao transmitir:', err.message);
    res.status(500).json({ error: 'Erro interno ao transmitir contingência' });
  }
});

// POST /nfe/consultar - Consultar protocolo NFe/NFCe
router.post('/consultar', async (req: Request, res: Response) => {
  try {
    const data: NFeConsultaRequest = req.body;

    if (!data.chaveAcesso || !validarChaveAcesso(data.chaveAcesso)) {
      res.status(400).json({ error: 'chaveAcesso inválida (44 dígitos + DV módulo 11)' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }
    if (!data.ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }

    const result = await nfeService.consultarProtocolo(data);
    res.json(result);
  } catch (err: any) {
    console.error('[NFe] Erro ao consultar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfe/cancelar - Cancelar NFe/NFCe
router.post('/cancelar', async (req: Request, res: Response) => {
  try {
    const data: NFeCancelarRequest = req.body;

    if (!data.chaveAcesso || !validarChaveAcesso(data.chaveAcesso)) {
      res.status(400).json({ error: 'chaveAcesso inválida (44 dígitos + DV módulo 11)' });
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
    if (!data.ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }
    // CNPJ sai da chave de acesso (posições 6-19)
    if (certMismatch(res, data.certificado, data.chaveAcesso.substring(6, 20))) return;

    const result = await nfeService.cancelarNFe(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFe] Erro ao cancelar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfe/carta-correcao - Carta de Correção
router.post('/carta-correcao', async (req: Request, res: Response) => {
  try {
    const data: NFeCartaCorrecaoRequest = req.body;

    if (!data.chaveAcesso || !validarChaveAcesso(data.chaveAcesso)) {
      res.status(400).json({ error: 'chaveAcesso inválida (44 dígitos + DV módulo 11)' });
      return;
    }
    if (!data.correcao || data.correcao.length < 15 || data.correcao.length > 1000) {
      res.status(400).json({ error: 'correcao deve ter entre 15 e 1000 caracteres' });
      return;
    }
    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }
    if (!data.ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }
    if (certMismatch(res, data.certificado, data.chaveAcesso.substring(6, 20))) return;

    const result = await nfeService.cartaCorrecao(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFe] Erro na carta de correção:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfe/inutilizar - Inutilizar numeração
router.post('/inutilizar', async (req: Request, res: Response) => {
  try {
    const data: NFeInutilizarRequest = req.body;

    if (!data.cnpj || !data.serie || !data.numeroInicial || !data.numeroFinal) {
      res.status(400).json({ error: 'Campos obrigatórios: cnpj, serie, numeroInicial, numeroFinal' });
      return;
    }
    if (!validarCNPJ(data.cnpj)) {
      res.status(400).json({ error: 'CNPJ inválido (DV incorreto)' });
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
    if (certMismatch(res, data.certificado, data.cnpj)) return;

    const result = await nfeService.inutilizar(data);
    const statusCode = result.success ? 200 : 422;
    res.status(statusCode).json(result);
  } catch (err: any) {
    console.error('[NFe] Erro ao inutilizar:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

// POST /nfe/status - Status do serviço SEFAZ
router.post('/status', async (req: Request, res: Response) => {
  try {
    const data: StatusServicoRequest = req.body;

    if (!data.certificado?.pfxBase64 || !data.certificado?.password) {
      res.status(400).json({ error: 'Certificado digital é obrigatório' });
      return;
    }
    if (!data.ufEmitente) {
      res.status(400).json({ error: 'ufEmitente é obrigatório' });
      return;
    }

    const result = await nfeService.statusServico(data);
    res.json(result);
  } catch (err: any) {
    console.error('[NFe] Erro ao consultar status:', err.message);
    res.status(500).json({ error: 'Erro interno ao processar a requisição' });
  }
});

export default router;
