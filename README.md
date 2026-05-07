# sefaz-api v2 — Motor Fiscal SaaS

Monorepo NestJS que migra a antiga API Express para um **motor fiscal multi-tenant** com gestão de certificado em envelope encryption, persistência em Postgres com RLS, filas em BullMQ e arquitetura modular pronta para escalar.

> Estado atual: a base de plataforma (auth, certificado, persistência, fila, observabilidade, build, testes) está completa e compilando. A orquestração SEFAZ por documento (SOAP autorização + polling + cancelamento + CC-e) é o próximo lote a ser portado dos arquivos em `legacy/`.

---

## Visão geral

```
apps/
  api/     # HTTP NestJS — controllers, guards, swagger
  worker/  # BullMQ workers + cron jobs (cert expiry, reconciliação SEFAZ)

libs/
  common/        # decorators (@CurrentTenant), errors, TenantContext, sanitize
  database/      # PrismaService com RLS por request
  crypto/        # EnvelopeEncryptionService (AES-256-GCM)
  kms/           # KmsService (LocalKmsProvider; AWS/GCP stubs)
  storage/       # StorageService (LocalStorageProvider; S3 stub)
  sefaz/         # SoapClientService, XmlSignerService, CircuitBreaker, endpoints
  fiscal-core/   # Builders NFe/NFCe/MDFe + utilitários (chave, CNPJ, datas, PFX)

prisma/
  schema.prisma  # Tenant, ApiKey, Certificate, Invoice, Webhook, AuditLog, UsageRecord
  sql/rls.sql    # políticas Row Level Security multi-tenant
  seed.ts        # bootstrap admin + primeira API key
```

## Decisões arquiteturais

- **NestJS monorepo** (apps + libs) com path mappings `@app/*` para libs.
- **Prisma + Postgres 16** com Row Level Security: cada request do tenant entra em `withTenantTx()` que aplica `set_config('app.tenant_id', ..., true)`. Mesmo um service que esquecer um filtro `WHERE tenantId` retorna zero linhas de outro tenant — defesa em profundidade.
- **Envelope encryption** do PFX: DEK aleatória por upload → AES-256-GCM nos bytes → KMS criptografa a DEK (EDEK). Senha vai direto pro KMS. Em dev usa `LocalKmsProvider` (AES-256-GCM com master key da env); em prod, plugar Cloud KMS / AWS KMS implementando o `KmsProvider`.
- **Multi-key API key auth**: `ApiKeyGuard` valida `Authorization: Bearer sk_...`, faz lookup por `sha256(key)`, anexa `req.tenant`. `TenantContextInterceptor` propaga via AsyncLocalStorage.
- **BullMQ** para webhooks com backoff exponencial. Worker em processo separado (`apps/worker`) para escalar independente do HTTP.
- **OpenAPI/Swagger** auto-gerado em `/docs` com `addBearerAuth`.
- **Idempotency-Key** suportado em `POST /v1/invoices` via decorator + unique constraint composto.
- **Audit log** via `AuditService` em toda operação sensível (CERT_UPLOAD, CERT_USE_SIGN, CERT_DELETE, INVOICE_EMIT, API_KEY_CREATE, …).
- **Circuit breaker** SEFAZ migrado, agora injetável via DI.

## Subir o ambiente

```bash
cp .env.example .env
# preencher RESP_TEC_*, KMS_LOCAL_MASTER_KEY=$(openssl rand -hex 32)

npm install
npm run docker:up                 # postgres + redis + localstack
npm run prisma:migrate -- --name init
psql "$DATABASE_URL" -f prisma/sql/rls.sql
npm run prisma:seed               # imprime a primeira API key

npm run start:dev                 # API em :3333  → /docs
npm run start:worker:dev          # worker em outro terminal
```

## Endpoints v1

```
POST   /v1/tenants/register         público — devolve API key uma vez
GET    /v1/tenants/me               auth
GET    /v1/api-keys                 lista chaves
POST   /v1/api-keys                 cria nova chave
DELETE /v1/api-keys/:id             revoga

POST   /v1/certificates             upload PFX (envelope encryption)
GET    /v1/certificates             lista + alertas de expiração
GET    /v1/certificates/:id
DELETE /v1/certificates/:id         direito ao esquecimento (LGPD)

POST   /v1/invoices                 cria NFe/NFCe/NFSe/MDFe (Idempotency-Key suportado)
GET    /v1/invoices                 lista com filtros
GET    /v1/invoices/:id
POST   /v1/invoices/:id/cancel
GET    /v1/invoices/:id/danfe       PDF (A4 ou 80mm)

POST   /v1/webhooks                 registra endpoint
GET    /v1/webhooks
DELETE /v1/webhooks/:id

GET    /health                      Terminus (postgres + KMS)
GET    /docs                        Swagger
```

## O que já está completo

- Estrutura de monorepo com builds individuais para api e worker
- Schema Prisma + RLS + seed
- Auth por API key com hash sha256, multi-key, prefixos visíveis, audit
- Certificate module com envelope encryption end-to-end e LGPD delete
- Tenant + ApiKey + Webhook + Audit + Storage proxy + Health controllers
- NFe/NFCe — recebem payload, buscam cert, decriptam, **constroem XML, assinam, persistem**, gravam XML no storage e marcam `PENDING` (enviar p/ SEFAZ + parsear retorno é o próximo passo)
- Worker com BullMQ webhook processor (HMAC SHA-256 + retry) + jobs cron (expiry, reconciliação)
- Migrado: utils (chave, CNPJ, PFX, datas), endpoints SEFAZ, circuit breaker, SOAP client, XML signer, NFe/NFCe/MDFe XML builders
- Vitest configurado, 7 testes passando (envelope encryption + chave de acesso)
- Docker Compose com postgres/redis/localstack
- Swagger, helmet, throttler, CORS

## Próximos lotes (em `legacy/services/*.ts`, ainda a portar)

1. **Orquestração SEFAZ NFe/NFCe**: SOAP autorização → retAutorizacao polling → parsing protocolo → status `AUTHORIZED`/`REJECTED` (1297 linhas em `legacy/services/nfe.service.ts`)
2. **DANFE PDF** com PDFKit (referência: `gestao-raiz/lib/danfe-generator.ts`)
3. **NFSe providers** (Betha, Nacional, São Paulo) — abstração já está no novo módulo
4. **MDFe orchestration** — builder migrado, falta SOAP MDFeRecepcaoSinc e encerramento
5. **SPED EFD-ICMS/IPI** (referência: `gestao-raiz/lib/sped-generator.ts`)
6. **KMS real**: Cloud KMS / AWS KMS providers (interface já existe)
7. **Storage S3**: implementar `S3StorageProvider` com `@aws-sdk/client-s3` + `getSignedUrl`
8. **Quota guard** por plano (modelo `UsageRecord` já criado)
9. **OpenTelemetry** export (config previsto)

## Estrutura legacy

A pasta `legacy/` preserva a API Express anterior com toda a lógica de SOAP/orquestração. Não é compilada nem incluída em testes — fica como referência exclusiva para o porte incremental dos serviços.
