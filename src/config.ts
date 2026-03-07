import dotenv from 'dotenv';
dotenv.config();

if (!process.env.API_KEY) {
  console.error('FATAL: variável de ambiente API_KEY é obrigatória');
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT || '3333', 10),
  apiKey: process.env.API_KEY,
  sefazAmbiente: (process.env.SEFAZ_AMBIENTE || 'homologacao') as 'producao' | 'homologacao',
  certsDir: process.env.CERTS_DIR || './certs',
};

// Ambiente SEFAZ: 1 = Produção, 2 = Homologação
export function getTpAmb(): '1' | '2' {
  return config.sefazAmbiente === 'producao' ? '1' : '2';
}
