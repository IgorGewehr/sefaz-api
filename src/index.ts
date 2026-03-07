import express from 'express';
import { config } from './config';
import { apiKeyAuth } from './middleware/auth';
import nfeRoutes from './routes/nfe.routes';
import mdfeRoutes from './routes/mdfe.routes';

const app = express();

// Parse JSON bodies (max 2MB — certificados A1 são ~5KB em base64)
app.use(express.json({ limit: '2mb' }));

// Health check (sem auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Todas as rotas fiscais exigem API key
app.use('/nfe', apiKeyAuth, nfeRoutes);
app.use('/mdfe', apiKeyAuth, mdfeRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler global
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERRO]', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`SEFAZ API rodando na porta ${config.port}`);
  console.log(`Ambiente: ${config.sefazAmbiente}`);
  console.log(`Endpoints:`);
  console.log(`  NFe:  POST /nfe/emitir, /nfe/consultar, /nfe/cancelar, /nfe/carta-correcao, /nfe/inutilizar, /nfe/status`);
  console.log(`  NFCe: POST /nfe/nfce/emitir`);
  console.log(`  MDFe: POST /mdfe/emitir, /mdfe/consultar, /mdfe/encerrar, /mdfe/cancelar, /mdfe/status`);
});

export default app;
