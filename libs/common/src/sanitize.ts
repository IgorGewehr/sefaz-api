/**
 * Recursively redacts secrets from arbitrary objects so they're safe to log.
 * Mirrors the redaction policy from the legacy logger but is framework-agnostic.
 */
const SENSITIVE_KEYS = [
  'pfxbase64',
  'pfx',
  'password',
  'passphrase',
  'authorization',
  'apikey',
  'api_key',
  'token',
  'secret',
  'privatekey',
  'private_key',
  'edek',
  'encryptedpfx',
  'encryptedpassword',
];

const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '[CERTIFICATE]'],
  [/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[PRIVATE_KEY]'],
  [/-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g, '[PRIVATE_KEY]'],
  [/Bearer\s+[\w-]+/gi, 'Bearer [REDACTED]'],
];

export function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (Buffer.isBuffer(value)) return `[Buffer:${value.byteLength}b]`;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}

function redactString(s: string): string {
  let out = s;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  if (out.length > 1024) out = `${out.slice(0, 256)}…[TRUNCATED ${out.length - 256}b]`;
  return out;
}
