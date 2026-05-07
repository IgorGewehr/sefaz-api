// ===========================================================================
// SEFAZ API - SOAP Request/Response Logger
//
// Logging especializado para requisições SOAP com SEFAZ
// Captura request/response, timing e erros
// Sanitiza XML para remover dados sensíveis
// ===========================================================================

import logger, { LogContext } from './index';

// =====================================================
// TYPES
// =====================================================

export interface SoapLogContext extends LogContext {
  soapAction?: string;
  url?: string;
  statusCode?: number;
  xmlSizeBytes?: number;
  operationType?: 'autorizacao' | 'consulta' | 'cancelamento' | 'carta_correcao' | 'inutilizacao' | 'status';
}

// =====================================================
// XML SANITIZATION
// =====================================================

/**
 * Sanitiza XML removendo certificados e assinaturas longas
 */
function sanitizeXml(xml: string): string {
  let sanitized = xml;

  // Remove assinaturas digitais (muito longas)
  sanitized = sanitized.replace(
    /<Signature[^>]*>[\s\S]*?<\/Signature>/g,
    '<Signature>[SIGNATURE_REMOVED]</Signature>'
  );

  // Remove certificados X509
  sanitized = sanitized.replace(
    /<X509Certificate>[\s\S]*?<\/X509Certificate>/g,
    '<X509Certificate>[CERTIFICATE_REMOVED]</X509Certificate>'
  );

  // Remove valores de assinatura
  sanitized = sanitized.replace(
    /<SignatureValue>[\s\S]*?<\/SignatureValue>/g,
    '<SignatureValue>[VALUE_REMOVED]</SignatureValue>'
  );

  // Remove DigestValue
  sanitized = sanitized.replace(
    /<DigestValue>[\s\S]*?<\/DigestValue>/g,
    '<DigestValue>[DIGEST_REMOVED]</DigestValue>'
  );

  // Truncate if still too long (>10KB)
  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000) + '\n... [TRUNCATED]';
  }

  return sanitized;
}

/**
 * Extrai informações chave do XML
 */
function extractXmlKeyInfo(xml: string): {
  chaveAcesso?: string;
  numero?: string;
  modelo?: string;
  serie?: string;
  cStat?: string;
  xMotivo?: string;
} {
  const info: any = {};

  // Chave de acesso
  const chaveMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/);
  if (chaveMatch) info.chaveAcesso = chaveMatch[1];

  // Número
  const numeroMatch = xml.match(/<nNF>(\d+)<\/nNF>/);
  if (numeroMatch) info.numero = numeroMatch[1];

  // Modelo
  const modeloMatch = xml.match(/<mod>(\d{2})<\/mod>/);
  if (modeloMatch) info.modelo = modeloMatch[1];

  // Série
  const serieMatch = xml.match(/<serie>(\d+)<\/serie>/);
  if (serieMatch) info.serie = serieMatch[1];

  // Status
  const cStatMatch = xml.match(/<cStat>(\d+)<\/cStat>/);
  if (cStatMatch) info.cStat = cStatMatch[1];

  // Motivo
  const xMotivoMatch = xml.match(/<xMotivo>(.*?)<\/xMotivo>/);
  if (xMotivoMatch) info.xMotivo = xMotivoMatch[1];

  return info;
}

// =====================================================
// SOAP LOGGING FUNCTIONS
// =====================================================

/**
 * Loga request SOAP antes de enviar
 */
export function logSoapRequest(
  url: string,
  soapAction: string,
  xmlBody: string,
  context?: LogContext
): void {
  const xmlInfo = extractXmlKeyInfo(xmlBody);
  const operationType = detectOperationType(soapAction);

  const logContext: SoapLogContext = {
    ...context,
    action: 'soap_request',
    soapAction,
    url,
    operationType,
    xmlSizeBytes: Buffer.byteLength(xmlBody, 'utf-8'),
    ...xmlInfo,
  };

  logger.info('SOAP request enviado', logContext);

  // Log XML completo apenas em DEBUG
  if (process.env.LOG_LEVEL === 'debug') {
    logger.debug('SOAP request XML', {
      ...logContext,
      xml: sanitizeXml(xmlBody),
    });
  }
}

/**
 * Loga response SOAP recebido
 */
export function logSoapResponse(
  url: string,
  soapAction: string,
  statusCode: number,
  responseXml: string,
  durationMs: number,
  context?: LogContext
): void {
  const xmlInfo = extractXmlKeyInfo(responseXml);
  const operationType = detectOperationType(soapAction);

  const logContext: SoapLogContext = {
    ...context,
    action: 'soap_response',
    soapAction,
    url,
    operationType,
    statusCode,
    xmlSizeBytes: Buffer.byteLength(responseXml, 'utf-8'),
    duration_ms: durationMs,
    ...xmlInfo,
  };

  // Log level baseado no status
  if (statusCode >= 200 && statusCode < 300) {
    // Sucesso - verificar cStat se disponível
    const isAuthorized = xmlInfo.cStat === '100' || xmlInfo.cStat === '150';
    const isProcessing = xmlInfo.cStat === '103' || xmlInfo.cStat === '105';
    const isRejected = xmlInfo.cStat && parseInt(xmlInfo.cStat) >= 200;

    if (isAuthorized) {
      logger.info('SOAP response recebido - AUTORIZADO', logContext);
    } else if (isProcessing) {
      logger.info('SOAP response recebido - PROCESSANDO', logContext);
    } else if (isRejected) {
      logger.warn('SOAP response recebido - REJEITADO', logContext);
    } else {
      logger.info('SOAP response recebido', logContext);
    }
  } else {
    logger.error('SOAP response com erro HTTP', undefined, logContext);
  }

  // Log XML completo apenas em DEBUG
  if (process.env.LOG_LEVEL === 'debug') {
    logger.debug('SOAP response XML', {
      ...logContext,
      xml: sanitizeXml(responseXml),
    });
  }
}

/**
 * Loga erro em request SOAP
 */
export function logSoapError(
  url: string,
  soapAction: string,
  error: Error,
  durationMs?: number,
  context?: LogContext
): void {
  const operationType = detectOperationType(soapAction);

  const logContext: SoapLogContext = {
    ...context,
    action: 'soap_error',
    soapAction,
    url,
    operationType,
    duration_ms: durationMs,
  };

  logger.error('Erro em SOAP request', error, logContext);
}

/**
 * Detecta tipo de operação pelo soapAction
 */
function detectOperationType(soapAction: string): SoapLogContext['operationType'] {
  const lower = soapAction.toLowerCase();

  if (lower.includes('autorizacao')) return 'autorizacao';
  if (lower.includes('consulta')) return 'consulta';
  if (lower.includes('cancelamento') || lower.includes('evento')) return 'cancelamento';
  if (lower.includes('carta') || lower.includes('correcao')) return 'carta_correcao';
  if (lower.includes('inutiliza')) return 'inutilizacao';
  if (lower.includes('status')) return 'status';

  return undefined;
}

/**
 * Wrapper para timing automático de operações SOAP
 */
export async function withSoapTiming<T>(
  url: string,
  soapAction: string,
  fn: () => Promise<T>,
  context?: LogContext
): Promise<T> {
  const startTime = Date.now();
  const operationType = detectOperationType(soapAction);

  const logContext: SoapLogContext = {
    ...context,
    soapAction,
    url,
    operationType,
  };

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    logger.info('Operação SOAP concluída', {
      ...logContext,
      action: 'soap_operation_completed',
      duration_ms: duration,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Operação SOAP falhou', error as Error, {
      ...logContext,
      action: 'soap_operation_failed',
      duration_ms: duration,
    });

    throw error;
  }
}

/**
 * Loga retry de operação SOAP
 */
export function logSoapRetry(
  url: string,
  soapAction: string,
  attempt: number,
  maxAttempts: number,
  delayMs: number,
  context?: LogContext
): void {
  const operationType = detectOperationType(soapAction);

  logger.warn('Retry de operação SOAP', {
    ...context,
    action: 'soap_retry',
    soapAction,
    url,
    operationType,
    attempt,
    maxAttempts,
    retryDelayMs: delayMs,
  });
}
