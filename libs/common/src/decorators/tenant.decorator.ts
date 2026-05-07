import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { TenantContext } from '../tenant-context';

export const CurrentTenant = createParamDecorator(
  (data: keyof TenantContext | undefined, ctx: ExecutionContext): TenantContext | unknown => {
    const req = ctx.switchToHttp().getRequest();
    const tenant: TenantContext | undefined = req.tenant;
    if (!tenant) {
      throw new Error('CurrentTenant() used on a route without ApiKeyGuard');
    }
    return data ? tenant[data] : tenant;
  },
);
