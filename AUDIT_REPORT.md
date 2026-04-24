# SEFAZ API — Relatorio de Auditoria Pre-Producao

**Branch:** `Gustavo`
**Executado por:** Claude (auditoria autonoma)
**Data:** 2026-04-24
**Checklist base:** `PRE_PRODUCTION_CHECKLIST.md`

---

## Sumario Executivo

Fiz uma bateria de verificacoes automatizada passando por todas as 11 secoes do checklist. Encontrei **21 findings** classificados em P0 a P3. Apliquei **fixes nao-invasivos** (remocao de logs que vazam dados sensiveis e remocao de arquivo com secrets hardcoded) que foram commitados na branch `Gustavo`.

**Validacao pos-fixes:**
- `npm run build` — 0 erros TypeScript em modo strict
- `npm test` — 136/136 testes passando

### Acoes urgentes que exigem sua decisao / intervencao

| # | Finding | Prioridade | Acao necessaria |
|---|---------|------------|-----------------|
| 1 | `test-firebase-cert.mjs` commitado com **Firebase service account + chave AES-256 hardcoded** | **P0** | **ROTACIONAR AGORA:** service account Firebase (`gestao-raiz`), chave `CERT_KEY_HEX` (1190...f057), limpar historico git (BFG/filter-branch) |
| 2 | CNPJ + nome + email + telefone de responsavel tecnico **hardcoded** em `xml-builder.ts` | **P0** | Decidir: env var global, per-tenant no payload, ou tabela de config |
| 3 | Sem multi-tenant / sem persistencia / sem rate-limit / CORS ausente | **P1** | Decidir escopo da v1 (gaps de arquitetura) |
| 4 | `console.log` com payload/PFX/XML em providers NFSe | **P1** | **JA CORRIGIDO nesta branch** |

---

## Fixes aplicados nesta branch

Commit alvo: `Gustavo` (nao push feito ainda — aguardando confirmacao).

1. **Remoção de `test-firebase-cert.mjs`** — arquivo continha hardcoded:
   - `CERT_KEY_HEX` (chave AES-256 usada para decriptar senhas de certificado A1)
   - `FIREBASE_SERVICE_ACCOUNT` completo (project_id `gestao-raiz`, private_key em PEM)
   - **O arquivo ja esta no historico do git (commit `695d473`)**. Remover do HEAD nao basta.
2. **`src/routes/nfse.routes.ts:83`** — removido `console.log('[NFS-e][/emitir] Payload recebido:', JSON.stringify(body, ...))` que vazava `pfxBase64` + `password` em cada emissao NFSe.
3. **`src/lib/nfse/nacional.provider.ts`** — removidos ~15 `console.log` de debug que imprimiam:
   - Tamanho do PFX decodificado
   - XML DPS **bruto + XML assinado** (inclui dados fiscais do emitente/tomador/valores)
   - Payload JSON serializado
   - Endpoint de emissao
   - Body bruto de rejeicao SEFAZ

---

## Findings por prioridade

### P0 — Criticos

#### F1. Secrets hardcoded em arquivo versionado
- **Arquivo:** `test-firebase-cert.mjs` (removido nesta branch)
- **Historico:** presente em commit `695d473` ("indio pro gusta")
- **Conteudo vazado:**
  - Firebase private key (RSA) do service account `firebase-adminsdk-fbsvc@gestao-raiz.iam.gserviceaccount.com`
  - `CERT_KEY_HEX` = chave AES-256-GCM usada pelo sistema saas-erp para encriptar senhas de certificado A1
- **Impacto:** quem tiver acesso ao repo consegue:
  - Autenticar como admin no projeto Firebase `gestao-raiz`
  - Decriptar TODAS as senhas de certificado armazenadas no Firestore do saas-erp
- **Mitigacao obrigatoria:**
  1. Gerar nova service account no Firebase e rotacionar `FIREBASE_SERVICE_ACCOUNT_JSON` em todos os ambientes
  2. Gerar nova `CERT_KEY_HEX` e **recriptar todos os certificados A1 armazenados** (saas-erp tem que decriptar+recriptar)
  3. Limpar historico: `git filter-repo --invert-paths --path test-firebase-cert.mjs` ou BFG
  4. Revogar service account antiga no console Firebase

#### F2. Responsavel tecnico hardcoded na NFe/NFCe
- **Arquivo:** `src/lib/nfe/xml-builder.ts:937-941` (NFe) e provavelmente `1054-1059` (NFCe)
- **Conteudo:**
  ```
  CNPJ: '65609793000196'
  xContato: 'Igor de Oliveira Gewehr'
  email: 'igor.gewehr1@gmail.com'
  fone: '11954409958'
  ```
- **Impacto fiscal:** toda NFe/NFCe emitida por QUALQUER cliente desta API vai registrar esse CNPJ/pessoa como responsavel tecnico no documento fiscal autorizado. Isso e exigencia da NT 2018.005 — responsavel tecnico e a *empresa que desenvolveu o software emissor*. Se correto legalmente (a empresa do Igor e o dev), e apenas uma questao de **PII em codigo**. Se nao, e irregularidade fiscal.
- **Acao:** extrair para env vars (`RESP_TEC_CNPJ`, `RESP_TEC_NOME`, `RESP_TEC_EMAIL`, `RESP_TEC_FONE`) e remover do codigo.

#### F3. XML injection em MDFe e Betha Legacy
- **Arquivos:** `src/lib/mdfe/xml-builder.ts:110-128,174-196`, `src/lib/nfse/betha-legacy.provider.ts:89-117,154`
- **Problema:** campos de texto do usuario (nome, logradouro, placa, discriminacao) inseridos diretamente no XML sem passar por `escapeXml()`.
- **Impacto:** usuario com `&` ou `<` no nome/descricao quebra o XML, invalida a assinatura, ou injeta tags maliciosas.
- **Acao:** envolver todos os textos de usuario com `escapeXml(...)` nos builders.

---

### P1 — Altos

#### F4. Logs de debug que imprimem payload / XML / PFX
- **Status:** CORRIGIDO (commits nesta branch).

#### F5. Polling sem distincao entre "processando" e "timeout"
- **Arquivos:** `src/services/nfe.service.ts:588-634`, `src/lib/nfse/betha.provider.ts:251-294`, `betha-legacy.provider.ts:415-429`
- **Problema:** apos 10 tentativas x 3s (30s), retorna `status: 'processando'` ou generico `'erro'` sem diferenciar. Cliente pode reenviar e gerar NFe duplicada (embora SEFAZ tipicamente rejeite com cStat=204 por chave duplicada).
- **Acao:** backoff exponencial, idempotency key baseada em `cNF+nNF+serie`, e retornar tambem `nRec` para que o cliente possa consultar depois sem reemitir.

#### F6. Timezone: `new Date()` em geracao de chave/dhEmi
- **Arquivos:** `src/services/nfe.service.ts:464`, `src/services/mdfe.service.ts:72`
- **Problema:** `new Date()` usa o timezone do servidor. `formatarDataSefaz` trata timezone por UF, mas `montarChaveAcesso` usa apenas year/month/day (menos sensivel). Se o servidor estiver em UTC e a emissao for no fim do dia no Brasil, pode cair no dia seguinte.
- **Acao:** converter `new Date()` para o timezone da UF do emitente antes de extrair AAMM na chave.

#### F7. CPF/CNPJ nao validam DV
- **Arquivos:** `src/lib/nfe/xml-builder.ts:591-594`, `src/lib/mdfe/xml-builder.ts:54`, `src/routes/nfse.routes.ts:86`
- **Problema:** so valida que ha digitos (via `apenasNumeros`) ou comprimento, nao o digito verificador.
- **Acao:** adicionar `validateCNPJ`/`validateCPF` e rejeitar no layer de rotas.

#### F8. Chave de acesso sem validar DV antes de usar
- **Arquivos:** `src/services/nfe.service.ts:965-999,1040-1082`, `src/services/mdfe.service.ts:177,230`
- **Problema:** `substring(0,2)`, `substring(6,20)`, `substring(20,22)` assumem chave valida de 44 digitos. Rotas validam `length === 44` mas nao o DV modulo 11.
- **Acao:** adicionar `validarChaveAcesso` que checa 44 digitos + DV.

#### F9. Rate limiting ausente
- **Arquivo:** `src/index.ts`
- **Problema:** uma unica API key global, sem rate limit. Cliente malicioso ou bug em cliente pode esgotar SEFAZ rapidamente.
- **Acao:** adicionar `express-rate-limit` com limite por IP + por API key.

#### F10. CORS nao configurado
- **Arquivo:** `src/index.ts` — checklist menciona `CORS_ORIGINS` mas codigo nao le. Atualmente sem header `Access-Control-Allow-Origin` algum.
- **Acao:** adicionar middleware `cors` com whitelist de dominios (saas-erp).

#### F11. Helmet/headers de seguranca ausentes
- **Arquivo:** `src/index.ts`
- **Problema:** sem `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`.
- **Acao:** adicionar `helmet()`.

---

### P2 — Medios

#### F12. `/api/metrics/reset` protegido so por API key
- **Arquivo:** `src/routes/metrics.routes.ts` + `src/index.ts:32`
- **Problema:** qualquer detentor da API key zera metricas, apagando evidencia de incidentes.
- **Acao:** adicionar header/role admin, ou remover em producao.

#### F13. Error handler global vaza stack trace em log
- **Arquivo:** `src/index.ts:40-43`
- **Problema:** `console.error('[ERRO]', err)` imprime objeto `err` completo, pode incluir campos sensiveis copiados de request.
- **Acao:** logar via logger estruturado que ja sanitiza.

#### F14. Subject CN do certificado vs CNPJ do emitente nao confrontado
- **Arquivo:** `src/lib/utils.ts:208` (parsePfx)
- **Problema:** PFX extrai `subject.CN` mas nao compara com `emitente.cnpj` do request. Cliente malicioso pode usar PFX de empresa X para emitir em nome de empresa Y (SEFAZ rejeita, mas e bom detectar antes).
- **Acao:** extrair CNPJ do subject e comparar com payload; rejeitar mismatch com 403.

#### F15. Cache de cert sem LRU (memory leak em multi-tenant)
- **Arquivo:** `src/lib/utils.ts:23`, `src/lib/sefaz/soap-client.ts:27`
- **Problema:** `Map` cresce indefinidamente. Em cenario multi-tenant com muitos PFX diferentes, memoria cresce ate OOM.
- **Acao:** implementar LRU com limite (ex.: 100 entradas).

#### F16. Sem circuit breaker para SEFAZ
- **Arquivo:** `src/lib/sefaz/soap-client.ts`
- **Problema:** quando SEFAZ trava/lenta, todas as requisicoes esperam timeout (60s) e enfileiram.
- **Acao:** implementar circuit breaker (ex.: `opossum`).

#### F17. Provider factory: codigoMunicipio vazio → default Nacional
- **Arquivo:** `src/lib/nfse/provider-factory.ts`
- **Problema:** se cliente esquece codigo, cai no provedor Nacional sem aviso. Pode emitir em provedor errado.
- **Acao:** exigir codigoMunicipio nao-vazio no validador de rota.

#### F18. SOAP logger: regex de redacao incompleta
- **Arquivo:** `src/lib/logger/soap-logger.ts:34-55`
- **Problema:** remove `<Signature>`, `<X509Certificate>`, `<SignatureValue>`, `<DigestValue>` mas nao cobre variantes com prefixo de namespace (`<ds:Signature>`) ou `<KeyInfo>` completo.
- **Acao:** ampliar regex para prefixos de namespace.

#### F19. Logger: truncamento em 100 chars nao basta para Base64 PFX
- **Arquivo:** `src/lib/logger/index.ts:103-104`
- **Problema:** campo `pfxBase64` (~7KB) truncado em 100 chars ainda vaza inicio do DER. Melhor e redact total baseado em nome de campo.
- **Acao:** incluir `pfxBase64` na lista de keys sempre redactadas (`[REDACTED]`).

---

### P3 — Baixos

#### F20. Inconsistencias menores de formato decimal
- **Arquivo:** `src/lib/nfe/xml-builder.ts` (varias linhas)
- **Problema:** varios fixed(2), alguns fixed(4), sem centralizacao.
- **Acao:** helper central tipado por campo fiscal.

#### F21. Documentacao `/documentation` publica
- **Arquivo:** `src/routes/documentation.routes.ts`
- **Problema:** decide-se se expoe publicamente. Nao e risco, mas concentra info para atacante mapear endpoints.
- **Acao:** considerar proteger por API key em producao.

---

## Validacao

```
$ npm run build
> tsc
(0 erros)

$ npm test
Test Files  6 passed (6)
Tests  136 passed (136)
Duration  2.05s
```

Todos os fixes aplicados **nao quebram** o build nem os testes existentes.

---

## Proximos passos recomendados (em ordem)

1. **ROTACIONAR secrets vazados** (F1) — nao comitar nada antes.
2. **Limpar historico git** do `test-firebase-cert.mjs` com BFG ou `git filter-repo`.
3. Decidir estrategia para responsavel tecnico (F2) — env var por deploy ou per-tenant.
4. Aplicar `escapeXml` nos builders MDFe e Betha legacy (F3).
5. Adicionar validacao de CNPJ/CPF/chaveAcesso por DV (F7, F8).
6. Adicionar `helmet`, `cors`, `express-rate-limit` (F9, F10, F11).
7. Definir estrategia de multi-tenant e persistencia antes de subir em producao.
8. Abordar F5 (polling + idempotency) antes de permitir retry automatico.

---

## Arquivos tocados nesta branch

```
D  test-firebase-cert.mjs
M  src/routes/nfse.routes.ts
M  src/lib/nfse/nacional.provider.ts
A  PRE_PRODUCTION_CHECKLIST.md
A  AUDIT_REPORT.md
```
