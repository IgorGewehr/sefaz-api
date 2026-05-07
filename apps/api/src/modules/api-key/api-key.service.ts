import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '@app/database';
import { AuditService } from '../audit/audit.service';

export interface IssuedApiKey {
  id: string;
  plaintext: string;
  prefix: string;
}

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async issue(tenantId: string, label: string, scopes: string[] = []): Promise<IssuedApiKey> {
    const env = process.env.NODE_ENV === 'production' ? 'live' : 'dev';
    const random = randomBytes(32).toString('base64url');
    const plaintext = `sk_${env}_${random}`;
    const hash = createHash('sha256').update(plaintext).digest('hex');
    const prefix = plaintext.slice(0, 14);

    const created = await this.prisma.asPrivileged().apiKey.create({
      data: { tenantId, keyHash: hash, prefix, label, scopes },
    });
    await this.audit.record('API_KEY_CREATE', {
      tenantId,
      resourceId: created.id,
      metadata: { label, prefix, scopes },
    });
    return { id: created.id, plaintext, prefix };
  }

  async list(tenantId: string) {
    return this.prisma.asPrivileged().apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        prefix: true,
        label: true,
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    const key = await this.prisma.asPrivileged().apiKey.findUnique({ where: { id } });
    if (!key || key.tenantId !== tenantId) throw new NotFoundException('API key not found');
    if (key.revokedAt) return;
    await this.prisma.asPrivileged().apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record('API_KEY_REVOKE', { tenantId, resourceId: id });
  }
}
