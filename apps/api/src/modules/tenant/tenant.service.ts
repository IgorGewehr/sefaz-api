import { ConflictException, Injectable } from '@nestjs/common';
import { Plan } from '@prisma/client';
import { PrismaService } from '@app/database';
import { AuditService } from '../audit/audit.service';
import { ApiKeyService } from '../api-key/api-key.service';
import { RegisterTenantDto } from './tenant.dto';

export interface TenantBootstrapResult {
  tenant: { id: string; name: string; email: string; plan: Plan; createdAt: Date };
  apiKey: { id: string; plaintext: string; prefix: string };
}

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Public registration — bootstraps a tenant and returns the first API key
   * in plaintext. The plaintext is shown only once.
   */
  async register(dto: RegisterTenantDto): Promise<TenantBootstrapResult> {
    const exists = await this.prisma
      .asPrivileged()
      .tenant.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException(`Tenant with email ${dto.email} already exists`);

    const tenant = await this.prisma.asPrivileged().tenant.create({
      data: { name: dto.name, email: dto.email, plan: dto.plan ?? Plan.FREE },
    });

    const apiKey = await this.apiKeys.issue(tenant.id, 'bootstrap');
    await this.audit.record('TENANT_CREATE', {
      tenantId: tenant.id,
      resourceId: tenant.id,
      metadata: { plan: tenant.plan },
    });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        plan: tenant.plan,
        createdAt: tenant.createdAt,
      },
      apiKey,
    };
  }

  async getById(id: string): Promise<{ id: string; name: string; email: string; plan: Plan } | null> {
    const t = await this.prisma.asPrivileged().tenant.findUnique({ where: { id } });
    if (!t || t.deletedAt) return null;
    return { id: t.id, name: t.name, email: t.email, plan: t.plan };
  }
}
