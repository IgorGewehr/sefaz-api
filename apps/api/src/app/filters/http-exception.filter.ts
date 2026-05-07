import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FiscalEngineError } from '@app/common';
import type { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = {
      code: 'internal_error',
      message: 'Erro interno',
    };

    if (exception instanceof FiscalEngineError) {
      status = exception.getStatus();
      const inner = exception.getResponse();
      body = typeof inner === 'object' ? (inner as Record<string, unknown>) : { message: String(inner) };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const inner = exception.getResponse();
      body =
        typeof inner === 'object'
          ? { code: code(status), ...(inner as Record<string, unknown>) }
          : { code: code(status), message: String(inner) };
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled error on ${req.method} ${req.url}: ${exception.message}`, exception.stack);
      body = { code: 'internal_error', message: exception.message };
    } else {
      this.logger.error(`Unknown exception on ${req.method} ${req.url}`, exception as never);
    }

    res.status(status).json({ ...body, path: req.url, timestamp: new Date().toISOString() });
  }
}

function code(status: number): string {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthorized';
    case 402: return 'payment_required';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 422: return 'unprocessable_entity';
    case 429: return 'too_many_requests';
    case 502: return 'bad_gateway';
    default: return 'error';
  }
}
