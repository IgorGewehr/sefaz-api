# SEFAZ API — Pre-Production Checklist

**Proposito:** Bateria de verificacoes e caca de bugs antes de subir o sefaz-api para producao.
**Ultima atualizacao:** 2026-04-23
**Stack:** Node 22 + TypeScript 5.8 + Express 5 + vitest. Sem DB, cache em memoria, SEFAZ via SOAP/mTLS com PFX A1.

> Cada secao e uma checagem independente. Marque com [x] conforme verificar.
> Execute na ordem: Seguranca → Certificados → Assinatura/XML → SOAP/SEFAZ → Emissao → Persistencia → Observabilidade → Performance → Deploy

---

## 1. SEGURANCA (Critica — fazer primeiro)

> Esta API emite documentos fiscais com certificado ICP-Brasil. Uma falha aqui gera multa, fraude ou vazamento de PFX.

### 1.1 Autenticacao & Autorizacao

- [ ] `API_KEY` obrigatoria no startup — app NAO sobe com chave ausente (ver [src/config.ts](src/config.ts))
- [ ] `apiKeyAuth` middleware aplicado em TODAS as rotas de emissao/consulta (NFe, NFCe, NFSe, MDFe) em [src/index.ts](src/index.ts)
- [ ] Comparacao da API key usa `timingSafeEqual` (nao `===`) — ver [src/middleware/auth.ts](src/middleware/auth.ts)
- [ ] `/health` permanece PUBLICO (sem auth) apenas para health checks
- [ ] `POST /api/metrics/reset` NAO e acessivel com API key comum — exigir role/flag admin ou remover em producao
- [ ] `/documentation` — decidir se fica publica ou protegida em producao
- [ ] **Multi-tenant:** definir estrategia — API key unica global vs. per-tenant — **gap atual: existe apenas 1 API key global**
- [ ] Caso multi-tenant: certificado PFX validado contra `businessId`/CNPJ do tenant (sem reuso cruzado)
- [ ] CORS: `CORS_ORIGINS` configurado com dominios especificos (nao `*`) em producao

### 1.2 Protecao do Certificado Digital (PFX A1)

- [ ] **PFX nunca logado em plaintext** — verificar que logger sanitiza `pfxBase64`, `password`, `certificate` (PEM), `privateKey` — ver sanitizacao em [src/lib/logger](src/lib/logger)
- [ ] **Remover `console.log` que imprime payload com PFX** — auditar [src/lib/nfse/providers/nacional.provider.ts](src/lib/nfse/providers/nacional.provider.ts) e demais providers
- [ ] Cache de certificados (`CERT_CACHE_TTL_MS`) chaveado por `sha256(pfxBase64+password)` — verificar que cache nunca retorna cert de outro tenant
- [ ] TTL do cache razoavel (default 8h) — nao manter PFX em memoria alem do necessario
- [ ] Cache limpa entradas expiradas (timer/LRU) — verificar memory leak
- [ ] Validacao de validade do certificado (`notAfter`) antes de assinar — rejeitar PFX expirado com erro claro
- [ ] Validar `notBefore` (certificado ainda nao valido)
- [ ] Validar cadeia ICP-Brasil (nao apenas parse) — decidir se exigido
- [ ] Dockerfile: volume `/app/certs` — confirmar que NAO contem PFX de cliente commitado (somente ca-certificates)
- [ ] `.env`, `.env.local`, `*.pfx`, `*.p12` no `.gitignore` — rodar `git log --all -- "*.pfx" "*.p12" ".env"` para confirmar que nunca foram commitados
- [ ] `grep -r "BEGIN RSA PRIVATE KEY\|BEGIN PRIVATE KEY\|MIIK\|MIIJ" src/ test-*.mjs` — nenhum cert/chave hardcoded no codigo ou em scripts de teste

### 1.3 TLS / mTLS

- [ ] `rejectUnauthorized: false` usado APENAS para endpoints SEFAZ (ICP-Brasil self-signed documentado) — auditar [src/lib/sefaz/soap-client.ts](src/lib/sefaz/soap-client.ts) e providers NFSe
- [ ] Nenhuma chamada a API externa generica usa `rejectUnauthorized: false`
- [ ] `https.Agent` configurado com `cert` + `key` + `ca` corretos para mTLS SEFAZ
- [ ] Timeout configurado em TODAS as requisicoes externas (`REQUEST_TIMEOUT_MS`, default 60s)

### 1.4 Validacao de Input

- [ ] **Adicionar schema validation (Zod) em todas as rotas** — atualmente validacao e manual/parcial em [src/services/nfe.service.ts](src/services/nfe.service.ts) e normalizers NFSe
- [ ] CNPJ emitente: validar digitos verificadores (nao apenas regex 14 digitos)
- [ ] CPF/CNPJ destinatario: validar DV
- [ ] `chaveAcesso` NFe/NFCe/MDFe: exatamente 44 digitos + validar DV da chave (modulo 11)
- [ ] `inscricaoMunicipal`, `codigoMunicipio` (IBGE 7 digitos): validar
- [ ] NCM (8 digitos), CFOP (4 digitos), CEST (7 digitos), CST/CSOSN: validar
- [ ] Valores monetarios: `>= 0`, com 2 decimais (nao NaN, nao Infinity)
- [ ] Quantidades: `> 0`
- [ ] Strings de texto (xProd, infAdic): limite de tamanho conforme layout SEFAZ
- [ ] **Injecao XML:** confirmar que TODOS os campos de string passam por `escapeXml()` nos builders (NFe, NFCe, NFSe, MDFe, eventos)
- [ ] Carta de correcao: 15-1000 chars validados antes do envio
- [ ] Payload size limit (`express.json({ limit })`) configurado — evitar DoS com body gigante

### 1.5 Rate Limiting & DoS

- [ ] **Habilitar rate limiter** (atualmente flag presente mas comentado) — limite por API key + por IP
- [ ] Rate limit especifico para `/metrics/reset` e endpoints pesados
- [ ] Limite de tentativas de polling SEFAZ (max 10, intervalo 3s) — ok, confirmar que nao multiplica em retry externo
- [ ] Helmet habilitado para headers de seguranca (se flag existe)

### 1.6 Segredos e Env

- [ ] `API_KEY` producao tem >= 32 bytes aleatorios (nao dev/demo)
- [ ] `.env` producao NAO no repo (`git ls-files | grep -i env`)
- [ ] Nenhum `console.log` de variavel sensivel — rodar `grep -rn "console.log" src/`
- [ ] Logger em producao nao grava em arquivo com permissoes world-readable (verificar `LOG_FILE_PATH`)

---

## 2. CERTIFICADO DIGITAL & ASSINATURA

### 2.1 Parse do PFX

- [ ] PFX base64 invalido retorna 400 com mensagem clara (nao crash/500)
- [ ] Senha errada do PFX retorna 400 com mensagem clara (nao vaza stack trace)
- [ ] PFX sem chave privada RSA: erro tratado
- [ ] PFX com multiplos certificados: escolhe o certificado correto (client cert, nao CA)
- [ ] Extrair CN/CNPJ do Subject do certificado e comparar com `emitente.cnpj` do payload (prevenir uso cruzado)

### 2.2 Assinatura XML (xml-crypto)

- [ ] Algoritmo de assinatura: SHA-1 default funciona em todas as UFs testadas — auditar [src/lib/sefaz/xml-signer.ts](src/lib/sefaz/xml-signer.ts)
- [ ] SHA-256: testar em UFs que exigem (verificar comentario sobre rejeicao SVRS homologacao)
- [ ] Canonicalization (C14N) correto: `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`
- [ ] Reference com `URI="#{Id}"` aponta para `infNFe.Id`/`infNFCe.Id`/`infEvento.Id`
- [ ] `Transforms`: enveloped-signature + C14N
- [ ] `X509Certificate` incluido dentro de `KeyInfo`
- [ ] Validar que XML assinado passa no validador da SEFAZ (schema XSD + digest)
- [ ] Eventos (cancelamento, CCe, inutilizacao) assinados corretamente — cada um tem Id proprio
- [ ] Lote NFe: assinatura dentro de cada NFe, nao no envelope do lote

### 2.3 XML Build

- [ ] Encoding UTF-8 declarado (`<?xml version="1.0" encoding="UTF-8"?>`) sem BOM
- [ ] Caracteres especiais (&, <, >, ", ') escapados em TODOS os campos texto
- [ ] Campos opcionais omitidos (nao enviar tag vazia quando nao ha valor)
- [ ] Ordem dos elementos obedece o XSD (xml-crypto nao reordena, mas builder deve)
- [ ] Decimais com ponto (nao virgula), casas conforme layout (2 para valores, 4 para quantidade, etc.)

---

## 3. SOAP / SEFAZ

### 3.1 Cliente SOAP

- [ ] Envelope SOAP 1.1 para NFe/NFCe/MDFe; 1.2 para NFSe SP — confirmar [src/lib/sefaz/soap-client.ts](src/lib/sefaz/soap-client.ts)
- [ ] Namespaces corretos por servico (nfeAutorizacao4, nfeRetAutorizacao4, nfeConsultaProtocolo4, recepcaoEvento4, nfeInutilizacao4, nfeStatusServico4)
- [ ] URLs de cada UF atualizadas — 29 UFs mapeadas (SP/MG/RS proprias, SVRS demais, SVAN MA, SVCAN/SVCRS contingencia)
- [ ] Ambiente (`tpAmb` 1=producao, 2=homologacao) alinhado com `SEFAZ_AMBIENTE` do config
- [ ] NFCe: endpoint distinto (SVRS/SP proprio) — confirmar roteamento

### 3.2 Respostas SEFAZ

- [ ] Parser XML extrai `cStat`, `xMotivo`, `nProt`, `chNFe`, `dhRecbto` corretamente
- [ ] Codigos de retorno mapeados para HTTP apropriado:
  - [ ] 100 (autorizado) → 200
  - [ ] 103/104 (lote em processamento) → polling
  - [ ] 110 (denegado) → 422 com detalhes
  - [ ] 215, 225 etc. (rejeicao) → 400/422 com cStat + xMotivo
  - [ ] Timeouts / 5xx SEFAZ → 503 com retry hint
- [ ] Polling async: max 10 tentativas x 3s — backoff exponencial seria melhor
- [ ] Retry/circuit breaker para SEFAZ fora do ar (documentado que SEFAZ cai frequentemente)

### 3.3 Contingencia

- [ ] Suporte a SVC-AN / SVC-RS quando UF principal esta fora
- [ ] NFCe offline: modo contingencia (emissao em lote) — decidir se suportado nesta versao

---

## 4. EMISSAO POR TIPO DE DOCUMENTO

### 4.1 NFe (Modelo 55)

- [ ] Emitente Simples Nacional (CRT=1): CSOSN usado, nao CST
- [ ] Emitente Normal (CRT=3): CST usado, calculo ICMS/PIS/COFINS/IPI
- [ ] Emitente Simples Excesso (CRT=2): regras especificas
- [ ] Operacao interestadual: DIFAL (FCP, ICMS partilha) calculado
- [ ] Transporte: modalidade (0-9), veiculo, reboque, volumes
- [ ] Cobranca: fatura + duplicatas com soma == total
- [ ] Itens: calculo `vProd = qCom * vUnCom` com tolerancia de arredondamento
- [ ] Total: `vNF = vProd + vFrete + vSeg + vOutro - vDesc + vICMSST + vIPI`
- [ ] Destinatario CPF vs CNPJ: validar e preencher tag correta
- [ ] Exterior: `idEstrangeiro` quando destinatario nao brasileiro

### 4.2 NFCe (Modelo 65)

- [ ] CSC (id + token) validado e usado no `cHashQRCode`
- [ ] QR Code gerado com URL correta da UF (producao vs homologacao)
- [ ] Sem destinatario: permitido
- [ ] Com CPF/CNPJ destinatario: opcional mas preenche tag
- [ ] Consumidor final (`indFinal=1`) e presenca (`indPres=1`) obrigatorios
- [ ] Pagamento: `tPag` (01=dinheiro, 03=credito, 04=debito, 17=pix, etc.) + `vPag` somando total

### 4.3 NFSe (Providers multiplos)

- [ ] **Betha:** SOAP, assinatura ABRASF — ver [src/__tests__/unit/betha-soap.test.ts](src/__tests__/unit/betha-soap.test.ts)
- [ ] **Sao Paulo:** SOAP 1.2, namespace proprio, link de visualizacao — testes recentes (commits `1af6592`, `ff78bbb`)
- [ ] **ADN (Nacional):** REST JSON com mTLS — ver [src/lib/nfse/providers/nacional.provider.ts](src/lib/nfse/providers/nacional.provider.ts)
- [ ] Normalizacao legado (RPS) x novo (DPS) em `normalizeEmitirRequest()` — ver [src/__tests__/unit/dps-builder.test.ts](src/__tests__/unit/dps-builder.test.ts)
- [ ] Codigo do servico (LC 116): mapeamento por municipio
- [ ] Lote RPS: max documentos, envio sincrono vs assincrono
- [ ] Consulta por protocolo + consulta por NFSe
- [ ] Cancelamento: motivo obrigatorio, prazo respeitado

### 4.4 MDFe

- [ ] Modal rodoviario: veiculo + condutor + reboques
- [ ] Percurso multi-UF: todas as UFs do trajeto
- [ ] Produto predominante + carga total
- [ ] Seguro: averbacao, responsavel
- [ ] Encerramento: `dtEnc`, `cUF`, `cMun` destino
- [ ] Cancelamento e inclusao de condutor (eventos)

### 4.5 Eventos

- [ ] **Cancelamento:** prazo (24h NFe, 30min NFCe), justificativa 15-255 chars, protocolo original
- [ ] **Carta de Correcao (CCe):** nao alterar valores, max 20 CCes, texto 15-1000 chars
- [ ] **Inutilizacao:** range de numero valido, ano atual, serie valida, justificativa 15-255

---

## 5. PERSISTENCIA (GAP CRITICO)

> **ESTADO ATUAL:** Nao ha camada de persistencia. Metrics em RAM, documentos emitidos nao armazenados, protocolos perdidos em restart.

- [ ] **Decidir:** persistir documentos emitidos (XML assinado + protocolo) em DB/storage? Ou cliente guarda?
- [ ] Se persistir: escolher PostgreSQL ou Firestore (alinhar com saas-erp)
- [ ] Tabela/collection `fiscalDocuments` com: `businessId`, `tipo`, `chaveAcesso`, `xmlAssinado`, `protocolo`, `status`, `cStat`, `xMotivo`, `createdAt`
- [ ] Log de auditoria imutavel (quem emitiu, quando, com qual cert fingerprint)
- [ ] Backup dos XMLs em Storage (S3/GCS) por periodo legal (5 anos)
- [ ] Idempotencia: reenvio com mesmo `cNF` + `nNF` nao duplica (SEFAZ ja protege via chave, mas API deve detectar)

---

## 6. OBSERVABILIDADE

- [ ] Logger estruturado JSON funcionando (console + file rotation)
- [ ] `requestId` (AsyncLocalStorage) propagado em TODOS os logs de uma request
- [ ] SOAP logger sanitiza `<Signature>`, `<X509Certificate>`, `<DigestValue>`
- [ ] Nivel de log em producao: `info` (nao `debug`)
- [ ] Metrics endpoint retorna health, performance, emissions, errors
- [ ] Integrar Sentry (ou similar) para captura de erros nao tratados
- [ ] Alertas: taxa de erro > X%, latencia SEFAZ > Y, cert expirando em 30d
- [ ] Correlacionar `requestId` com `nRec` / `nProt` da SEFAZ nos logs

---

## 7. PERFORMANCE

- [ ] Cache de agentes HTTPS (`AGENT_CACHE_TTL_MS` 8h) — reuso de TCP/TLS com SEFAZ
- [ ] Cache de certificados (PFX parseado) funcionando — verificar hit rate em logs
- [ ] Nenhum `await` serial onde pode ser paralelo (itens de NFe, lotes NFSe)
- [ ] Memory leak: cache de cert/agent com limite de entradas (LRU) — evitar crescimento infinito em multi-tenant
- [ ] Teste de carga: 50 emissoes concorrentes com mesmo PFX — sem erro de socket/cert
- [ ] `MAX_RETRY_ATTEMPTS=3` — suficiente, com backoff exponencial
- [ ] Response time p95 < 5s para emissao sincrona

---

## 8. TRATAMENTO DE ERROS & EDGE CASES

### 8.1 Erros de Rede / SEFAZ

- [ ] SEFAZ timeout: retorna 504 com `requestId` e orientacao
- [ ] SEFAZ 500: retorna 502 com detalhes
- [ ] DNS falha: retorna 503
- [ ] Certificado rejeitado pelo SEFAZ (`cStat=280`): erro claro, nao retry infinito
- [ ] Chave duplicada (`cStat=204`): consulta protocolo existente e retorna, nao erro

### 8.2 Edge Cases

- [ ] Body JSON invalido: 400 com mensagem (nao stack trace)
- [ ] Content-Type errado: 415
- [ ] PFX corrompido: 400 claro
- [ ] Campos opcionais ausentes: defaults corretos, nao crash
- [ ] Numero/serie com zeros a esquerda: nao perde o zero
- [ ] Item com `vDesc > vProd`: rejeitar no service antes do envio
- [ ] NFe com 0 itens: rejeitar
- [ ] NFe com > 990 itens: rejeitar (limite SEFAZ)
- [ ] Valor total negativo ou zero: rejeitar
- [ ] Data de emissao futura ou muito antiga: rejeitar
- [ ] UF emitente != UF do SOAP endpoint: erro claro

### 8.3 Concorrencia

- [ ] Duas requests com mesmo `cNF` + `nNF` + cert: ambas chegam na SEFAZ, segunda recebe 204 (duplicidade) — tratado
- [ ] Cache de certificado sob race condition: verificar (dois parses simultaneos do mesmo PFX nao quebram)

---

## 9. TESTES

- [ ] `npm test` passa 100% — ver [src/__tests__/](src/__tests__/)
- [ ] Cobertura minima: servicos core (nfe, nfse, mdfe), signers, soap-client
- [ ] Testes unitarios para `validateNFePayload`, `normalizeEmitirRequest`, `escapeXml`, builders
- [ ] Teste de assinatura XML: round-trip (assinar → verificar)
- [ ] E2E de emissao NFe em homologacao SEFAZ — `src/__tests__/e2e/nfe-emission.test.ts`
- [ ] E2E NFCe em homologacao
- [ ] E2E NFSe (Betha, SP, ADN) em homologacao
- [ ] Teste de rejeicao: payload invalido retorna erro correto
- [ ] Teste de timeout SEFAZ mockado

---

## 10. PRE-DEPLOY (Infra & Docker)

### 10.1 Build & Dependencias

- [ ] `npm run build` — 0 erros TypeScript em `strict`
- [ ] `npm audit --production` — sem vulnerabilidades high/critical
- [ ] `package-lock.json` commitado e alinhado
- [ ] Sem devDependencies no bundle final (Dockerfile multi-stage faz isso)

### 10.2 Dockerfile / Compose

- [ ] Verificar **porta**: codigo usa `config.port` (default 3333), Dockerfile healthcheck em 3333 — alinhar com logs de startup (mencao a 3001 precisa ser investigada) — ver [Dockerfile](Dockerfile) e [src/index.ts](src/index.ts)
- [ ] Multi-stage build: runtime slim, sem tsx/vitest/tsc
- [ ] `ca-certificates` + `openssl` instalados (necessarios para ICP-Brasil)
- [ ] Healthcheck no Docker funcional (`wget`/`curl` para `/health`)
- [ ] Volume `certs-data` nao necessario se PFX vem sempre no request — remover se nao usado
- [ ] User nao-root no container
- [ ] Mem limit 1GB suficiente para cache de N certificados
- [ ] Cloudflared tunnel configurado e com dominio estavel

### 10.3 Env Producao

- [ ] `NODE_ENV=production`
- [ ] `SEFAZ_AMBIENTE=producao` (nao `homologacao`!)
- [ ] `API_KEY` forte (>= 32 bytes, gerado com `crypto.randomBytes`)
- [ ] `LOG_LEVEL=info`, `LOG_OUTPUT=file` (ou integrado com stack de logs)
- [ ] `CORS_ORIGINS` com dominio real do saas-erp
- [ ] `REQUEST_TIMEOUT_MS`, `CERT_CACHE_TTL_MS`, `AGENT_CACHE_TTL_MS` revisados
- [ ] Variaveis sensiveis em secret manager (nao `.env` no host)

### 10.4 Monitoramento Pos-Deploy

- [ ] Endpoint `/health` monitorado por uptime check externo
- [ ] `/api/metrics/health` integrado em dashboard
- [ ] Log aggregator recebe logs JSON (Loki/Datadog/CloudWatch)
- [ ] Alerta: API down > 1 min
- [ ] Alerta: taxa de rejeicao SEFAZ > 10%
- [ ] Alerta: p95 latency > 10s

---

## 11. GAPS CONHECIDOS (PRIORIZAR ANTES DO DEPLOY)

> Levantados na analise do codigo atual. Decidir: bloqueiam deploy ou ficam para proxima iteracao.

1. [ ] **Multi-tenant:** API key unica, sem escopo por `businessId`/CNPJ. Qualquer cliente com a key pode emitir com qualquer PFX enviado.
2. [ ] **Sem persistencia:** documentos emitidos nao sao guardados. Se saas-erp nao guarda, perde-se o XML. Confirmar responsabilidade.
3. [ ] **Metrics em memoria:** reset no restart. OK para MVP, nao para SLA.
4. [ ] **Rate limiting desabilitado:** flag existe mas comentado.
5. [ ] **`/metrics/reset` sem protecao admin:** qualquer holder da API key zera.
6. [ ] **`console.log` com payload em providers NFSe:** ruido em producao, arriscado se incluir dados sensiveis.
7. [ ] **Validacao de input manual/parcial:** adotar Zod nas rotas.
8. [ ] **Cert cache sem LRU:** pode crescer sem limite em cenario multi-tenant.
9. [ ] **Sem circuit breaker para SEFAZ:** instabilidade do SEFAZ propaga para o app.
10. [ ] **Porta inconsistente (3333 vs 3001 em logs):** investigar e alinhar.

---

## Progresso Geral

| Secao | Items | Verificados | Status |
|-------|-------|------------|--------|
| 1. Seguranca | 34 | 0 | ⬜ Pendente |
| 2. Certificado & Assinatura | 18 | 0 | ⬜ Pendente |
| 3. SOAP/SEFAZ | 12 | 0 | ⬜ Pendente |
| 4. Emissao por Tipo | 39 | 0 | ⬜ Pendente |
| 5. Persistencia | 6 | 0 | ⬜ Pendente |
| 6. Observabilidade | 8 | 0 | ⬜ Pendente |
| 7. Performance | 7 | 0 | ⬜ Pendente |
| 8. Erros & Edge Cases | 22 | 0 | ⬜ Pendente |
| 9. Testes | 9 | 0 | ⬜ Pendente |
| 10. Pre-Deploy | 22 | 0 | ⬜ Pendente |
| 11. Gaps Conhecidos | 10 | 0 | ⬜ Pendente |
| **TOTAL** | **187** | **0** | ⬜ |

---

*Execute em homologacao SEFAZ antes de apontar para producao. Cada secao pode ser delegada a um agente ou validada manualmente com Postman/Insomnia contra o ambiente de homologacao.*
