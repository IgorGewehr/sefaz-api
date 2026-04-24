import dotenv from 'dotenv';
dotenv.config();

// API_KEY (singular) ou API_KEYS (plural, separado por vírgula) — ao menos um é obrigatório.
// A variante plural permite rotação de chaves sem downtime: valida-se qualquer uma das listadas.
const apiKeysRaw = (process.env.API_KEYS || process.env.API_KEY || '').trim();
const apiKeys = apiKeysRaw
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

if (apiKeys.length === 0) {
  console.error('FATAL: variável de ambiente API_KEY (ou API_KEYS) é obrigatória');
  process.exit(1);
}

const respTecCnpj = process.env.RESP_TEC_CNPJ;
const respTecContato = process.env.RESP_TEC_CONTATO;
const respTecEmail = process.env.RESP_TEC_EMAIL;
const respTecFone = process.env.RESP_TEC_FONE;

if (!respTecCnpj || !respTecContato || !respTecEmail || !respTecFone) {
  console.error(
    'FATAL: variáveis RESP_TEC_CNPJ, RESP_TEC_CONTATO, RESP_TEC_EMAIL e RESP_TEC_FONE são obrigatórias ' +
    '(responsável técnico exigido pela NT 2018.005 no infRespTec da NFe/NFCe).'
  );
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3333', 10),
  /** @deprecated usar apiKeys */
  apiKey: apiKeys[0],
  apiKeys,
  adminKey: process.env.ADMIN_KEY, // opcional; usado para endpoints destrutivos (ex.: /metrics/reset)
  sefazAmbiente: (process.env.SEFAZ_AMBIENTE || 'homologacao') as 'producao' | 'homologacao',
  certsDir: process.env.CERTS_DIR || './certs',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),

  // Circuit breaker SEFAZ — opt-out via env
  circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
  circuitBreakerThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '5', 10),
  circuitBreakerWindowMs: parseInt(process.env.CIRCUIT_BREAKER_WINDOW_MS || '30000', 10),
  circuitBreakerCooldownMs: parseInt(process.env.CIRCUIT_BREAKER_COOLDOWN_MS || '15000', 10),

  // Cert ↔ emitente CNPJ check — opt-out via env (defaults ON em produção)
  validateCertCnpj: process.env.VALIDATE_CERT_CNPJ !== 'false',

  respTec: {
    cnpj: respTecCnpj.replace(/\D/g, ''),
    contato: respTecContato,
    email: respTecEmail,
    fone: respTecFone.replace(/\D/g, ''),
  },
};

// Ambiente SEFAZ: 1 = Produção, 2 = Homologação
export function getTpAmb(): '1' | '2' {
  return config.sefazAmbiente === 'producao' ? '1' : '2';
}
