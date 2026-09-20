# Plataforma NF-e — Backend (Express + TypeScript + Supabase)

Esqueleto inicial da API, seguindo o plano de construção (etapa E1). Nenhuma
regra fiscal foi implementada de verdade ainda — as rotas de certificado,
importação de XML, dashboard, SEFAZ e DANFE estão como stubs com `TODO`
apontando exatamente o que a etapa correspondente do plano exige.

## Como rodar

```bash
npm install
cp .env.example .env   # preencher com o projeto Supabase do grupo
npm run dev
```

`GET /health` deve responder `{ "status": "ok" }`.

## O que já existe

- **Autenticação** (`middleware/authenticate.ts`): valida o JWT do Supabase
  **localmente** contra o JWKS do projeto (`jose` + `SUPABASE_JWKS_URL`),
  sem round-trip ao serviço de Auth a cada requisição. Confira se o
  `issuer`/`audience` no código batem com os do seu projeto (aparecem no
  payload de qualquer token decodificado em jwt.io).
- **Empresa** (`modules/company`): `GET/POST /api/company` — a empresa é
  sempre resolvida pelo `userId` (claim `sub` do token), nunca por um
  `company_id` enviado pelo cliente.
- **Infra de segurança**:
  - `infra/supabase.ts` — cliente publishable (uso pontual de API pública) e
    administrativo com a **secret key** (só para importação/certificados/NSU,
    sempre filtrando por empresa).
  - `infra/crypto.ts` — AES-256-GCM com AAD para cifrar o A1 e sua senha.
- **Tratamento de erros** (`middleware/errorHandler.ts`): resposta padronizada
  `{ code, message, requestId, retryAt? }`, sem stack trace nem segredos.
- **Migration inicial** (`supabase/migrations/0001_init.sql`): tabelas
  `profiles`, `companies`, `certificates`, `nfe_documents`, `nfe_events`,
  `sync_state`, com RLS e políticas por dono.

## O que falta (por etapa do plano)

| Etapa | Módulo | Pendência principal |
|---|---|---|
| E3 | `modules/nfe` | Parser XML, extração de metadados/itens/impostos, persistência idempotente |
| E4 | `modules/nfe`, `modules/dashboard` | Regra de movimentação (tpNF), leitura fiscal ICMS/DIFAL/FCP, filtros/paginação, agregações |
| E5 | `modules/certificates`, `modules/danfe` | Validação PKCS#12, criptografia do A1, geração de PDF |
| E6 | `modules/sefaz` | Cliente SOAP/TLS, controle de NSU, lock de sincronização, tratamento de 137/138/656 |

Antes de implementar qualquer uma dessas etapas, reler a seção correspondente
do plano de construção — as regras de negócio (não inventar zero, não somar
manualmente EMIT+DEST, não zerar NSU, etc.) estão descritas lá em detalhe e
não estão repetidas aqui.

## Convenções

- Rota valida → serviço aplica a regra → função de persistência fala com o
  Supabase. Só criar uma camada `repository` separada se isso reduzir
  duplicação real.
- Valores monetários trafegam como string decimal na API pública; internamente
  usar `numeric` no Postgres (considerar `decimal.js` no cálculo em memória).
- Nunca logar senha, PFX, chave privada, JWT ou XML completo.
