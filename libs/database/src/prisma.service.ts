import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '@app/common';

/**
 * PrismaService extends PrismaClient and runs every query inside a transaction
 * scoped to the current tenant context. The transaction sets `app.tenant_id`
 * via `set_config(..., true)` (true = scope to txn), which the Postgres RLS
 * policies match against. If the request has no tenant context (e.g. health
 * check, public endpoints), queries run without the GUC and RLS-protected
 * tables return zero rows by design.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly tenantContext: TenantContextService) {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` inside a transaction with `app.tenant_id` set so RLS policies
   * see only the current tenant's rows. Use this for any query that touches
   * a tenant-scoped table outside of an existing transaction.
   */
  async withTenantTx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    const ctx = this.tenantContext.get();
    return this.$transaction(async (tx) => {
      if (ctx?.tenantId) {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, ctx.tenantId);
      }
      return fn(tx as unknown as PrismaClient);
    });
  }

  /**
   * Bypass RLS — use only for ApiKey lookup, tenant registration, and
   * background jobs that need to span tenants.
   */
  asPrivileged(): PrismaClient {
    return this;
  }
}
