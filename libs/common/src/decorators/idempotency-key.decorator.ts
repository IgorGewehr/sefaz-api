import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest();
    const value = req.headers['idempotency-key'];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  },
);
