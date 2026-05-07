import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  apiKeyId: string;
  scopes: string[];
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * AsyncLocalStorage-backed tenant context. Set in the API key guard once the
 * caller is authenticated, then consumed by Prisma middleware (RLS) and the
 * audit interceptor without having to thread it through every service call.
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  run<T>(ctx: TenantContext, fn: () => T): T {
    return this.storage.run(ctx, fn);
  }

  get(): TenantContext | undefined {
    return this.storage.getStore();
  }

  require(): TenantContext {
    const ctx = this.storage.getStore();
    if (!ctx) {
      throw new Error('TenantContext not set — request likely missed the ApiKeyGuard');
    }
    return ctx;
  }
}
