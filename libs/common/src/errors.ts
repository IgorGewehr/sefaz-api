import { HttpException, HttpStatus } from '@nestjs/common';

export class FiscalEngineError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export class TenantNotFoundError extends FiscalEngineError {
  constructor(id: string) {
    super('tenant_not_found', `Tenant ${id} not found`, HttpStatus.NOT_FOUND);
  }
}

export class InvalidApiKeyError extends FiscalEngineError {
  constructor() {
    super('invalid_api_key', 'API key inválida ou revogada', HttpStatus.UNAUTHORIZED);
  }
}

export class CertificateError extends FiscalEngineError {
  constructor(message: string, details?: unknown) {
    super('certificate_error', message, HttpStatus.BAD_REQUEST, details);
  }
}

export class CertificateExpiredError extends FiscalEngineError {
  constructor(expiresAt: Date) {
    super('certificate_expired', `Certificado expirou em ${expiresAt.toISOString()}`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class CertificateMismatchError extends FiscalEngineError {
  constructor() {
    super(
      'certificate_cnpj_mismatch',
      'CNPJ do certificado não bate com o CNPJ do emitente',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class QuotaExceededError extends FiscalEngineError {
  constructor(plan: string, limit: number) {
    super(
      'quota_exceeded',
      `Limite do plano ${plan} excedido (${limit})`,
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class SefazError extends FiscalEngineError {
  constructor(message: string, details?: unknown) {
    super('sefaz_error', message, HttpStatus.BAD_GATEWAY, details);
  }
}

export class IdempotencyConflictError extends FiscalEngineError {
  constructor(key: string) {
    super(
      'idempotency_conflict',
      `Idempotency-Key '${key}' já foi usada com payload diferente`,
      HttpStatus.CONFLICT,
    );
  }
}
