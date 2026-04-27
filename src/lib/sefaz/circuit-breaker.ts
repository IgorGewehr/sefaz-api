// ============================================================
// Circuit Breaker simples (in-memory) para endpoints SEFAZ
//
// Objetivo: quando um endpoint da SEFAZ fica instável (timeouts/5xx em
// sequência), abrir o circuito por alguns segundos e falhar rápido, em vez
// de enfileirar requests de 60s cada.
//
// Conservador por design:
//   - Estado por endpoint (hostname + pathname)
//   - Só conta falha de conexão/timeout/5xx; respostas 2xx/4xx são sucesso
//     (4xx vem do SEFAZ — problema no payload, não no serviço)
//   - Se desabilitado via env, vira no-op
// ============================================================

import { config } from '../../config';

interface EndpointState {
  failures: number[];     // timestamps em ms
  openedAt: number | null;
}

const state = new Map<string, EndpointState>();

function getKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return url;
  }
}

function getState(key: string): EndpointState {
  let s = state.get(key);
  if (!s) {
    s = { failures: [], openedAt: null };
    state.set(key, s);
  }
  return s;
}

/**
 * Throws if the circuit for `url` is currently open. Call before sending.
 */
export function assertClosed(url: string): void {
  if (!config.circuitBreakerEnabled) return;
  const key = getKey(url);
  const s = getState(key);
  if (s.openedAt !== null) {
    const elapsed = Date.now() - s.openedAt;
    if (elapsed < config.circuitBreakerCooldownMs) {
      const retryIn = Math.ceil((config.circuitBreakerCooldownMs - elapsed) / 1000);
      throw new Error(
        `Circuito aberto para ${key} após falhas consecutivas. Tente novamente em ~${retryIn}s.`
      );
    }
    // cooldown expirou → half-open: permite passar e reseta
    s.openedAt = null;
    s.failures = [];
  }
}

export function recordSuccess(url: string): void {
  if (!config.circuitBreakerEnabled) return;
  const s = getState(getKey(url));
  s.failures = [];
  s.openedAt = null;
}

export function recordFailure(url: string): void {
  if (!config.circuitBreakerEnabled) return;
  const key = getKey(url);
  const s = getState(key);
  const now = Date.now();
  // descarta falhas fora da janela
  s.failures = s.failures.filter(ts => now - ts <= config.circuitBreakerWindowMs);
  s.failures.push(now);
  if (s.failures.length >= config.circuitBreakerThreshold && s.openedAt === null) {
    s.openedAt = now;
  }
}

// Exposto para testes / observabilidade
export function _snapshot() {
  return Array.from(state.entries()).map(([k, v]) => ({
    endpoint: k,
    failures: v.failures.length,
    open: v.openedAt !== null,
  }));
}

export function _reset() {
  state.clear();
}
