import dotenv from 'dotenv';
dotenv.config();

if (!process.env.API_KEY) {
  console.error('FATAL: variável de ambiente API_KEY é obrigatória');
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
  apiKey: process.env.API_KEY,
  adminKey: process.env.ADMIN_KEY, // opcional; usado para endpoints destrutivos (ex.: /metrics/reset)
  sefazAmbiente: (process.env.SEFAZ_AMBIENTE || 'homologacao') as 'producao' | 'homologacao',
  certsDir: process.env.CERTS_DIR || './certs',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),           // requests por janela por IP+key
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
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
