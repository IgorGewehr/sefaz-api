import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { PrismaService } from '@app/database';
import { InvalidApiKeyError } from '@app/common';

export const PUBLIC_ROUTE = Symbol('public_route');

/**
 * Validates `Authorization: Bearer <api-key>`. Looks up the key by sha256(plaintext),
 * fails closed on any mismatch, and attaches the resolved tenant context to `req`.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header = (req.headers['authorization'] as string) || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) throw new InvalidApiKeyError();

    const plaintext = m[1].trim();
    const hash = createHash('sha256').update(plaintext).digest('hex');

    const key = await this.prisma
      .asPrivileged()
      .apiKey.findUnique({ where: { keyHash: hash }, include: { tenant: true } });

    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) {
      throw new InvalidApiKeyError();
    }
    if (key.tenant.deletedAt) throw new InvalidApiKeyError();

    // Touch lastUsedAt — fire-and-forget; never block the request
    void this.prisma.asPrivileged().apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    req.tenant = {
      tenantId: key.tenantId,
      apiKeyId: key.id,
      scopes: key.scopes ?? [],
    };
    return true;
  }
}
