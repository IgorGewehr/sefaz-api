import { Injectable, Logger } from '@nestjs/common';
import { AuditOperation, Prisma } from '@prisma/client';
import { PrismaService } from '@app/database';
import { TenantContextService } from '@app/common';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async record(
    operation: AuditOperation,
    args: {
      tenantId?: string;
      resourceId?: string;
      metadata?: Prisma.InputJsonValue;
    } = {},
  ): Promise<void> {
    const ctx = this.tenantContext.get();
    const tenantId = args.tenantId ?? ctx?.tenantId;
    if (!tenantId) {
      this.logger.warn(`Audit ${operation} skipped — no tenantId available`);
      return;
    }
    try {
      await this.prisma.asPrivileged().auditLog.create({
        data: {
          tenantId,
          operation,
          resourceId: args.resourceId,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          apiKeyId: ctx?.apiKeyId || null,
          metadata: args.metadata ?? Prisma.JsonNull,
        },
      });
    } catch (err) {
      // Audit must never block business flow — log and move on.
      this.logger.error(`Failed to write audit ${operation}: ${(err as Error).message}`);
    }
  }
}
