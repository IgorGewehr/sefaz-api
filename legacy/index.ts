import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from './config';
import { apiKeyAuth, adminKeyAuth } from './middleware/auth';
import nfeRoutes from './routes/nfe.routes';
import nfseRoutes from './routes/nfse.routes';
import mdfeRoutes from './routes/mdfe.routes';
import metricsRoutes, { trackMetrics } from './routes/metrics.routes';
import documentationRoutes from './routes/documentation.routes';

const app = express();

// Headers de segurança
app.use(helmet());

// CORS — whitelist via CORS_ORIGINS (vazio = sem CORS)
if (config.corsOrigins.length > 0) {
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
}

// Parse JSON bodies (max 2MB — certificados A1 são ~5KB em base64)
app.use(express.json({ limit: '2mb' }));

// Rate limit global: por IP + Authorization header
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator aplica o prefix correto pra IPv6 (/64 por default), evitando
  // que múltiplos clientes no mesmo /64 compartilhem contador
  keyGenerator: (req, res) => `${ipKeyGenerator(req.ip || '', false)}:${req.headers.authorization || 'anon'}`,
  message: { error: 'Rate limit excedido. Aguarde e tente novamente.' },
});

// Track metrics for all requests
app.use(trackMetrics);

// Health check (sem auth, sem rate limit)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Documentação pública (sem auth)
app.use('/documentation', documentationRoutes);

// Todas as rotas fiscais exigem API key + rate limit
app.use('/nfe', limiter, apiKeyAuth, nfeRoutes);
app.use('/nfse', limiter, apiKeyAuth, nfseRoutes);
app.use('/mdfe', limiter, apiKeyAuth, mdfeRoutes);

// Metrics (leitura com API key, reset exige admin key — montado dentro das rotas)
app.use('/api/metrics', apiKeyAuth, metricsRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler global
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERRO]', err?.message || err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Export para testes; só sobe servidor fora do vitest
if (process.env.NODE_ENV !== 'test') {
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`SEFAZ API rodando na porta ${config.port}`);
    console.log(`Ambiente: ${config.sefazAmbiente}`);
  });
}

export { adminKeyAuth };
export default app;
