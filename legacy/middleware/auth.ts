import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Constant-time membership test against a list of valid keys.
 * Iterates all entries regardless of match to avoid timing leaks between positions.
 */
function matchesAny(candidate: string, valid: string[]): boolean {
  let matched = false;
  for (const k of valid) {
    if (safeEqual(candidate, k)) matched = true;
  }
  return matched;
}

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

  if (!matchesAny(token, config.apiKeys)) {
    res.status(403).json({ error: 'API key inválida' });
    return;
  }

  next();
}

/**
 * Requer header X-Admin-Key igual a config.adminKey.
 * Usado em endpoints destrutivos (ex.: /metrics/reset). Se ADMIN_KEY não estiver
 * configurada, o endpoint fica desabilitado (403).
 */
export function adminKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const adminKey = req.headers['x-admin-key'];
  if (!config.adminKey) {
    res.status(403).json({ error: 'Endpoint administrativo desabilitado (ADMIN_KEY não configurada)' });
    return;
  }
  if (typeof adminKey !== 'string' || !safeEqual(adminKey, config.adminKey)) {
    res.status(403).json({ error: 'Admin key inválida' });
    return;
  }
  next();
}
