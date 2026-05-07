import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { TenantContextService } from '@app/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';

/**
 * Wraps every request in a TenantContextService.run(...) so the request-scoped
 * AsyncLocalStorage is populated for any downstream service. The ApiKey guard
 * sets `req.tenant` earlier in the lifecycle; this interceptor reads it back
 * and binds it. Routes without an authenticated tenant still get a requestId.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const requestId = (req.headers['x-request-id'] as string) || `req_${randomUUID()}`;
    req.requestId = requestId;

    const tenant = req.tenant as
      | { tenantId: string; apiKeyId: string; scopes: string[] }
      | undefined;

    return new Observable((subscriber) => {
      this.tenantContext.run(
        {
          tenantId: tenant?.tenantId ?? '',
          apiKeyId: tenant?.apiKeyId ?? '',
          scopes: tenant?.scopes ?? [],
          requestId,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
        () => {
          next.handle().subscribe({
            next: (v) => subscriber.next(v),
            error: (e) => subscriber.error(e),
            complete: () => subscriber.complete(),
          });
        },
      );
    });
  }
}
