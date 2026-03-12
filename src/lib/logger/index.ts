// ===========================================================================
// SEFAZ API - Sistema de Logging Estruturado
//
// Logger baseado em níveis com suporte a múltiplos transports
// Formato JSON estruturado para facilitar parsing e análise
// Sanitização automática de dados sensíveis (certificados, senhas)
// ===========================================================================

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

// =====================================================
// TYPES
// =====================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  requestId?: string;
  action?: string;
  ufEmitente?: string;
  chaveAcesso?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  duration_ms?: number;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

export type Transport = (entry: LogEntry) => void | Promise<void>;

// =====================================================
// CONFIGURATION
// =====================================================

const LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
const LOG_OUTPUT = process.env.LOG_OUTPUT || 'console';
const LOG_FILE_PATH = process.env.LOG_FILE_PATH;
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE || '10485760', 10); // 10MB default

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// =====================================================
// SENSITIVE DATA PATTERNS
// =====================================================

const SENSITIVE_FIELDS = [
  'pfxBase64',
  'password',
  'passphrase',
  'apiKey',
  'token',
  'authorization',
  'certificate',
  'pfx',
];

const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/pfxBase64/i, '[REDACTED]'],
  [/password/i, '[REDACTED]'],
  [/passphrase/i, '[REDACTED]'],
  [/api[_-]?key/i, '[REDACTED]'],
  [/token/i, '[REDACTED]'],
  [/bearer\s+[\w-]+/gi, 'Bearer [REDACTED]'],
  [/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '[CERTIFICATE]'],
  [/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[PRIVATE_KEY]'],
];

// =====================================================
// SANITIZATION
// =====================================================

/**
 * Sanitiza dados sensíveis de um objeto recursivamente
 */
function sanitize(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    let sanitized = data;
    for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }

    // Truncate very long strings (likely base64 certificates)
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 100) + '... [TRUNCATED]';
    }

    return sanitized;
  }

  if (Array.isArray(data)) {
    return data.map(sanitize);
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Check if field is sensitive
      if (SENSITIVE_FIELDS.some(field => lowerKey.includes(field.toLowerCase()))) {
        if (typeof value === 'string' && value.length > 8) {
          // Show only first 4 characters for API keys
          sanitized[key] = lowerKey.includes('key') || lowerKey.includes('token')
            ? `${value.substring(0, 4)}...`
            : '[REDACTED]';
        } else {
          sanitized[key] = '[REDACTED]';
        }
      } else {
        sanitized[key] = sanitize(value);
      }
    }
    return sanitized;
  }

  return data;
}

// =====================================================
// TRANSPORTS
// =====================================================

/**
 * Console transport - outputs to stdout/stderr
 */
const consoleTransport: Transport = (entry: LogEntry) => {
  const output = JSON.stringify(entry);

  if (entry.level === 'error') {
    console.error(output);
  } else {
    console.log(output);
  }
};

/**
 * File transport - writes to file with rotation
 */
let fileTransport: Transport | null = null;

if (LOG_OUTPUT === 'file' && LOG_FILE_PATH) {
  fileTransport = async (entry: LogEntry) => {
    try {
      const logDir = path.dirname(LOG_FILE_PATH);

      // Ensure directory exists
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Check file size for rotation
      if (fs.existsSync(LOG_FILE_PATH)) {
        const stats = fs.statSync(LOG_FILE_PATH);
        if (stats.size > LOG_MAX_SIZE) {
          // Rotate: rename with timestamp
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const rotatedPath = `${LOG_FILE_PATH}.${timestamp}`;
          fs.renameSync(LOG_FILE_PATH, rotatedPath);
        }
      }

      // Append log entry
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(LOG_FILE_PATH, line, 'utf8');
    } catch (error) {
      // Fallback to console if file write fails
      console.error('Failed to write to log file:', error);
      consoleTransport(entry);
    }
  };
}

// =====================================================
// REQUEST ID CONTEXT
// =====================================================

import { AsyncLocalStorage } from 'async_hooks';

const asyncLocalStorage = new AsyncLocalStorage<{ requestId: string }>();

/**
 * Gets current request ID from context
 */
function getCurrentRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

/**
 * Runs a function with a request ID context
 */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return asyncLocalStorage.run({ requestId }, fn);
}

// =====================================================
// LOGGER CLASS
// =====================================================

class Logger {
  private transports: Transport[] = [];
  private defaultContext: LogContext = {};

  constructor() {
    // Initialize transports based on configuration
    this.transports.push(consoleTransport);

    if (fileTransport) {
      this.transports.push(fileTransport);
    }
  }

  /**
   * Sets default context for all logs
   */
  setDefaultContext(context: LogContext): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  /**
   * Checks if a log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL];
  }

  /**
   * Creates a log entry and sends to transports
   */
  private async log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error,
    durationMs?: number
  ): Promise<void> {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: sanitize({
        ...this.defaultContext,
        requestId: getCurrentRequestId(),
        ...context,
      }) as LogContext,
    };

    if (durationMs !== undefined) {
      entry.duration_ms = durationMs;
    }

    if (error) {
      entry.error = {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        code: (error as any).code,
      };
    }

    // Send to all transports
    for (const transport of this.transports) {
      try {
        await transport(entry);
      } catch (err) {
        // Prevent logging errors from breaking the application
        console.error('Transport error:', err);
      }
    }
  }

  /**
   * Debug level logging
   */
  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  /**
   * Info level logging
   */
  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  /**
   * Warning level logging
   */
  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  /**
   * Error level logging
   */
  error(message: string, error?: Error, context?: LogContext): void {
    this.log('error', message, context, error);
  }

  /**
   * Logs with timing information
   */
  async withTiming<T>(
    action: string,
    fn: () => Promise<T>,
    context?: LogContext
  ): Promise<T> {
    const startTime = Date.now();
    const actionContext = { ...context, action };

    this.debug(`Starting: ${action}`, actionContext);

    try {
      const result = await fn();
      const duration = Date.now() - startTime;

      this.info(`Completed: ${action}`, { ...actionContext, duration_ms: duration });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.error(
        `Failed: ${action}`,
        error as Error,
        { ...actionContext, duration_ms: duration }
      );

      throw error;
    }
  }

  /**
   * Creates a child logger with additional default context
   */
  child(context: LogContext): Logger {
    const childLogger = new Logger();
    childLogger.defaultContext = { ...this.defaultContext, ...context };
    childLogger.transports = this.transports;
    return childLogger;
  }
}

// =====================================================
// SINGLETON INSTANCE
// =====================================================

const logger = new Logger();

export default logger;

// =====================================================
// CONVENIENCE EXPORTS
// =====================================================

export const debug = logger.debug.bind(logger);
export const info = logger.info.bind(logger);
export const warn = logger.warn.bind(logger);
export const error = logger.error.bind(logger);
export const withTiming = logger.withTiming.bind(logger);
export const setDefaultContext = logger.setDefaultContext.bind(logger);
export const createChildLogger = logger.child.bind(logger);

// =====================================================
// REQUEST ID GENERATOR
// =====================================================

/**
 * Generates a unique request ID
 */
export function generateRequestId(): string {
  return `req_${uuidv4()}`;
}
