import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization header com Bearer token é obrigatório' });
    return;
  }

  const token = authHeader.slice(7);
  if (!token) {
    res.status(401).json({ error: 'Token vazio' });
    return;
  }

  const tokenBuf = Buffer.from(token);
  const keyBuf = Buffer.from(config.apiKey);
  if (tokenBuf.length !== keyBuf.length || !timingSafeEqual(tokenBuf, keyBuf)) {
    res.status(403).json({ error: 'API key inválida' });
    return;
  }

  next();
}
