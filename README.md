# Plataforma NF-e — Backend (Express + TypeScript + Supabase)

API completa para gestão de NF-es: importação de XML, dashboard fiscal, certificados A1, geração de DANFE e sincronização com SEFAZ.

## Como rodar

```bash
npm install
cp .env.example .env   # preencher com o projeto Supabase do grupo
npm run dev
```

`GET /health` deve responder `{ "status": "ok" }`.

## Visão geral das funcionalidades implementadas

| Etapa | Módulo                                                                                                | Status       |
| ----- | ----------------------------------------------------------------------------------------------------- | ------------ |
| E1    | Auth, Company, Infra                                                                                  | ✅ Concluído |
| E3    | `modules/nfe` — Import XML, listagem, detalhe, XML original, eventos                                  | ✅ Concluído |
| E4    | `modules/nfe`, `modules/dashboard` — Movimento (tpNF), ICMS/DIFAL/FCP, filtros, paginação, agregações | ✅ Concluído |
| E5    | `modules/certificates` — PKCS#12, validação CNPJ/validade/par-chave, AES-256-GCM, upload/delete       | ✅ Concluído |
| E5    | `modules/danfe` — PDF via Puppeteer, template HTML escapado, disposition inline/attachment            | ✅ Concluído |
| E6    | `modules/sefaz` — distNSU SOAP/TLS mTLS, lock atômico, NSU, cStat 137/138/656, nunca zera NSU         | ✅ Concluído |

## O que existe

### Autenticação (`middleware/authenticate.ts`)

Valida o JWT do Supabase **localmente** contra o JWKS do projeto (`jose` + `SUPABASE_JWKS_URL`), sem round-trip ao serviço de Auth a cada requisição. O `issuer`/`audience` devem bater com os do seu projeto (aparecem no payload de qualquer token decodificado em jwt.io).

### Empresa (`modules/company`)

- `GET /api/company` — retorna a empresa do usuário autenticado
- `POST /api/company` — cria empresa (CNPJ, razão social, UF)
- A empresa é **sempre resolvida pelo `userId`** (claim `sub` do token), nunca por um `company_id` enviado pelo cliente.

### Infra de segurança

- `infra/supabase.ts` — cliente publishable (API pública) e administrativo com **secret key** (importação/certificados/NSU, sempre filtrando por `company_id` do usuário).
- `infra/crypto.ts` — AES-256-GCM com AAD para cifrar o A1 (PFX) e sua senha. O AAD amarra o envelope a `${companyId}:${certificateId}:pfx` / `:password`.

### Tratamento de erros (`middleware/errorHandler.ts`)

Resposta padronizada `{ code, message, requestId, retryAt? }`, sem stack trace nem segredos.

### Migration inicial (`supabase/migrations/0001_init.sql`)

Tabelas: `profiles`, `companies`, `certificates`, `nfe_documents`, `nfe_events`, `sync_state`, com RLS e políticas por dono.

### Storage buckets necessários

- `fiscal-documents` — XMLs originais das NF-es (privado)
- `certificates` — PFXs cifrados (privado)
- `sefaz-responses` — Respostas brutas da SEFAZ por attempt_id (privado)

## Rotas da API

Todas as rotas de negócio exigem `Authorization: Bearer <JWT>`.

### Empresa

| Método | Rota           | Descrição                                 |
| ------ | -------------- | ----------------------------------------- |
| GET    | `/api/company` | Retorna empresa do usuário autenticado    |
| POST   | `/api/company` | Cria empresa (`taxId`, `legalName`, `uf`) |

### NF-e Importação (E3)

| Método | Rota                  | Descrição                                                                                                                                                                                              |
| ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/nfe/import`     | Importa XML (multipart `xml`, query `environment=homologacao\|producao`). Valida modelo 55 + protocolo, extrai metadados/itens/impostos, idempotente por `company_id+environment+access_key`.          |
| GET    | `/api/nfe`            | Lista com filtros: `from`, `to`, `movement` (ENTRY/EXIT/REVIEW), `number`, `counterpartyTaxId`, `accessKey`, `status`, `environment`, `page`, `pageSize`. Ordenação estável `issued_at desc, id desc`. |
| GET    | `/api/nfe/:id`        | Busca por ID + company_id                                                                                                                                                                              |
| GET    | `/api/nfe/:id/xml`    | Recupera XML original do Storage. Query `disposition=inline\|attachment`.                                                                                                                              |
| GET    | `/api/nfe/:id/events` | Eventos vinculados à mesma chave de acesso                                                                                                                                                             |

### Dashboard (E4)

| Método | Rota             | Descrição                                                                                                                                                                                                                                                                             |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/dashboard` | Agregações de NF-es elegíveis (situação conhecida + XML completo + movimento ENTRY/EXIT). Retorna `totals` (entries/exits), `taxes` (icms, difalDest, fcpDest), `coverage` (ex: "18 de 20 notas com valor legível"). Filtros: `from`, `to`, `environment` (homologacao/producao/all). |

### Certificados A1 (E5)

| Método | Rota               | Descrição                                                                                                                                                                                                                                                       |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/certificate` | Metadados do certificado ativo (sem `storage_path`, `password_*`).                                                                                                                                                                                              |
| POST   | `/api/certificate` | Upload PFX (multipart `certificate` + field `password`). Valida: senha correta, CNPJ do subject = empresa, validade vigente, par chave-certificado. Cifra PFX e senha (AES-256-GCM + AAD), persiste no Storage + tabela. Só 1 ativo por empresa (unique index). |
| DELETE | `/api/certificate` | Desativa registro, apaga arquivo/segredo cifrados, preserva NF-es já importadas.                                                                                                                                                                                |

### DANFE (E5)

| Método | Rota                 | Descrição                                                                                                                                     |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/nfe/:id/danfe` | Gera PDF do DANFE. Exige XML completo + protocolo de autorização. Query `disposition=inline\|attachment`. Nunca persiste PDF permanentemente. |

### SEFAZ Sync (E6)

| Método | Rota                              | Descrição                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/sefaz/sync?environment=...` | Lê `sync_state` (last_nsu, max_nsu, next_allowed_at, lock_until, recovery_required, etc.).                                                                                                                                                                                                                                                                                   |
| POST   | `/api/sefaz/sync?environment=...` | Executa distNSU: adquire lock atômico, exige A1 utilizável + `next_allowed_at` permitido, chama SEFAZ via SOAP/TLS mTLS com A1 decifrado **apenas em memória**, salva resposta bruta no Storage **antes** de extrair, trata cStat 138 (has_more), 137 (NSU inválido → `recovery_required=true`, **nunca zera NSU**), 656. Atualiza `last_nsu`, `max_nsu`, `next_allowed_at`. |

## Exemplos de uso

### Importar XML de NF-e

```bash
curl -X POST http://localhost:3333/api/nfe/import \
  -H "Authorization: Bearer $TOKEN" \
  -F "xml=@nota.xml" \
  -F "environment=producao"
```

### Listar NF-es com filtros

```bash
curl -G http://localhost:3333/api/nfe \
  -H "Authorization: Bearer $TOKEN" \
  -d "from=2024-01-01" \
  -d "to=2024-01-31" \
  -d "movement=EXIT" \
  -d "page=1" \
  -d "pageSize=20"
```

### Dashboard fiscal

```bash
curl -G http://localhost:3333/api/dashboard \
  -H "Authorization: Bearer $TOKEN" \
  -d "from=2024-01-01" \
  -d "to=2024-12-31" \
  -d "environment=all"
```

### Upload de certificado A1

```bash
curl -X POST http://localhost:3333/api/certificate \
  -H "Authorization: Bearer $TOKEN" \
  -F "certificate=@certificado.pfx" \
  -F "password=senha123"
```

### Gerar DANFE

```bash
curl -G http://localhost:3333/api/nfe/<uuid>/danfe \
  -H "Authorization: Bearer $TOKEN" \
  -d "disposition=attachment" \
  --output danfe.pdf
```

### Sincronizar com SEFAZ

```bash
curl -X POST http://localhost:3333/api/sefaz/sync \
  -H "Authorization: Bearer $TOKEN" \
  -d "environment=producao"
```

## Variáveis de ambiente obrigatórias (`.env`)

```env
PORT=3333
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173

SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon/public key>
SUPABASE_SECRET_KEY=<service_role key>
SUPABASE_JWKS_URL=https://<project>.supabase.co/auth/v1/jwks

CERT_MASTER_KEY_BASE64=<base64 de 32 bytes para AES-256>
CERT_MASTER_KEY_VERSION=1

CERTIFICATE_MAX_BYTES=2097152
XML_MAX_BYTES=5242880

SEFAZ_ENVIRONMENT=homologacao
```

## Convenções

- Rota valida → serviço aplica a regra → persistência fala com Supabase. Camada `repository` só se reduzir duplicação real.
- Valores monetários trafegam como **string decimal** na API pública; internamente `numeric` no Postgres.
- Nunca logar senha, PFX, chave privada, JWT ou XML completo.
- Empresa **sempre** resolvida pelo `userId` (claim `sub`), nunca por `company_id` do cliente.
- `sync_state.lock_until`/`lock_token` garantem sincronização sequencial por empresa+ambiente.
- NSU **nunca zerado** automaticamente — cStat 137 marca `recovery_required` para intervenção manual.

## Scripts

```bash
npm run dev       # tsx watch
npm run build     # tsc
npm run start     # node dist/server.js
npm run typecheck # tsc --noEmit
npm run test      # vitest run
```
