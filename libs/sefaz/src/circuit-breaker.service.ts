import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EndpointState {
  failures: number[];
  openedAt: number | null;
}

/**
 * In-memory circuit breaker per SEFAZ endpoint. Migrated from
 * legacy/lib/sefaz/circuit-breaker.ts. State is per-process — for multi-pod
 * deployments push this into Redis later.
 */
@Injectable()
export class CircuitBreakerService {
  private readonly state = new Map<string, EndpointState>();
  private readonly enabled: boolean;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;

  constructor(config: ConfigService) {
    this.enabled = config.get<string>('CIRCUIT_BREAKER_ENABLED', 'true') !== 'false';
    this.threshold = parseInt(config.get<string>('CIRCUIT_BREAKER_THRESHOLD', '5'), 10);
    this.windowMs = parseInt(config.get<string>('CIRCUIT_BREAKER_WINDOW_MS', '30000'), 10);
    this.cooldownMs = parseInt(config.get<string>('CIRCUIT_BREAKER_COOLDOWN_MS', '15000'), 10);
  }

  assertClosed(url: string): void {
    if (!this.enabled) return;
    const key = this.getKey(url);
    const s = this.getState(key);
    if (s.openedAt !== null) {
      const elapsed = Date.now() - s.openedAt;
      if (elapsed < this.cooldownMs) {
        const retryIn = Math.ceil((this.cooldownMs - elapsed) / 1000);
        throw new Error(`Circuito aberto para ${key}. Tente em ~${retryIn}s.`);
      }
      s.openedAt = null;
      s.failures = [];
    }
  }

  recordSuccess(url: string): void {
    if (!this.enabled) return;
    const s = this.getState(this.getKey(url));
    s.failures = [];
    s.openedAt = null;
  }

  recordFailure(url: string): void {
    if (!this.enabled) return;
    const s = this.getState(this.getKey(url));
    const now = Date.now();
    s.failures = s.failures.filter((ts) => now - ts <= this.windowMs);
    s.failures.push(now);
    if (s.failures.length >= this.threshold && s.openedAt === null) {
      s.openedAt = now;
    }
  }

  snapshot(): Array<{ endpoint: string; failures: number; open: boolean }> {
    return Array.from(this.state.entries()).map(([k, v]) => ({
      endpoint: k,
      failures: v.failures.length,
      open: v.openedAt !== null,
    }));
  }

  reset(): void {
    this.state.clear();
  }

  private getKey(url: string): string {
    try {
      const u = new URL(url);
      return `${u.hostname}${u.pathname}`;
    } catch {
      return url;
    }
  }

  private getState(key: string): EndpointState {
    let s = this.state.get(key);
    if (!s) {
      s = { failures: [], openedAt: null };
      this.state.set(key, s);
    }
    return s;
  }
}
