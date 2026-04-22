# CLAUDE.md — Guia de Ambiente Dev para Agentes

Este arquivo é lido automaticamente pelo Claude Code ao abrir o projeto.
Objetivo: configurar o ambiente local corretamente após `git clone`, sem precisar debugar.

Leia também, nesta ordem:
1. **[AGENTS.md](AGENTS.md)** — regras operacionais, riscos críticos, postura de mudança
2. **[docs/runtime-truth.md](docs/runtime-truth.md)** — verdade de produção (Docker, Nginx, basePath)
3. **[docs/dev-agent-macbook.md](docs/dev-agent-macbook.md)** — fluxo alternativo via Docker Compose para o app

---

## Ambiente de desenvolvimento — fluxo nativo (recomendado no macOS/CLI)

Este projeto usa **Next.js 15 + Drizzle ORM + PostgreSQL**.
O fluxo nativo roda `npm run dev` diretamente no host e conecta a um Postgres local via Docker.

### 1. Banco de dados local

```bash
docker compose -f docker-compose.dev.yml up -d db
```

Isso sobe o Postgres na porta **5434** (não 5432, para evitar conflito com instâncias locais).
- Host: `localhost:5434`
- DB: `taximetro`
- User: `taximetro`
- Pass: `taximetro_dev`

### 2. `.env.local`

Crie `.env.local` na raiz do projeto (já está no `.gitignore`):

```env
NODE_ENV=development

DATABASE_URL=postgresql://taximetro:taximetro_dev@localhost:5434/taximetro

AUTH_SECRET=dev-only-secret-change-me
AUTH_URL=http://localhost:3000

GOOGLE_CLIENT_ID=dev
GOOGLE_CLIENT_SECRET=dev

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_TOKEN_NEXT=
TELEGRAM_GROUP_ID=

SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=dev
SMTP_PASS=dev
SMTP_FROM=Taximetro Dev <dev@local>
```

### 3. Dependências

```bash
npm install
```

### 4. Schema + seed

```bash
npm run db:push      # aplica schema no banco local
npm run db:seed      # admin user + bases + faculdades
npm run db:seed-dev  # ~50 interns/preceptors/líderes fake (usa @faker-js/faker com seed 42)
```

Ou em um único comando:

```bash
npm run db:demo   # equivale a db:seed + db:seed-dev
```

### 5. Rodar a app

```bash
npm run dev
```

Acesse: **http://localhost:3000/taximetro/login**

### 6. Credenciais de teste

| Papel       | Email                  | Senha      |
|-------------|------------------------|------------|
| COORDINATOR | caio.olive94@gmail.com | admin123   |

Os interns/preceptors/líderes fake criados por `seed-dev` têm email no padrão `usuario.NNN@dev.local` e senha `dev123` (ver `src/db/seed-dev.ts`).

### 7. Testes

```bash
npm test
```

Usa `node:test` nativo com `tsx`. Arquivos em `tests/**/*.test.ts`.

---

## CRÍTICO — `secureCookie` no NextAuth

**Nunca** use `secureCookie: true` em chamadas `getToken`. Use sempre:

```typescript
secureCookie: process.env.NODE_ENV === "production"
```

**Por quê:** Em HTTP (dev), NextAuth define o cookie como `authjs.session-token`.
Em HTTPS (prod), define como `__Secure-authjs.session-token`.
Se `secureCookie: true` estiver hardcoded, `getToken` procura o cookie com prefixo `__Secure-`
e não encontra nada em dev — retorna `null` silenciosamente, causando redirect para `/login`
ou erro 401/403 mesmo com o usuário logado.

Arquivos onde isso importa: `src/middleware.ts`, `src/lib/impersonate.ts`, e todos os `route.ts` que chamam `getToken`.

---

## Estrutura de URLs (basePath `/taximetro`)

| Destino                  | URL                                          |
|--------------------------|----------------------------------------------|
| Login                    | http://localhost:3000/taximetro/login        |
| Admin dashboard          | http://localhost:3000/taximetro/admin        |
| Auth API (NextAuth)      | http://localhost:3000/taximetro/api/auth/... |
| Health check             | http://localhost:3000/taximetro/api/health   |

O `basePath: "/taximetro"` está em `next.config.ts`. Todos os `fetch` do lado client já incluem `/taximetro/` explicitamente — **não remova esse prefixo**.

A NextAuth usa `basePath: "/taximetro/api/auth"` (ver `src/lib/auth.ts`).

---

## Seed de desenvolvimento — segurança

`src/db/seed-dev.ts` tem dupla proteção contra rodar em produção:

1. Aborta se `NODE_ENV === "production"`
2. Aborta se `DATABASE_URL` não contém um host de desenvolvimento (`localhost`, `127.0.0.1`, `db`, etc.)

Escape hatch deliberado (apenas para testes controlados com banco remoto de staging):
```bash
SEED_DEV_FORCE=1 npm run db:seed-dev
```

Nunca commitar com `SEED_DEV_FORCE=1` ativo.

---

## Reset completo do banco local

```bash
npm run db:reset
# equivale a: clean-dev → seed → seed-dev
```

Ou para apagar o volume Docker e recriar do zero:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d db
npm run db:push && npm run db:demo
```

---

## Referências rápidas

| Arquivo                                             | O que é                                         |
|-----------------------------------------------------|-------------------------------------------------|
| `src/middleware.ts`                                 | Auth guard + redirect por role                  |
| `src/lib/auth.ts`                                   | Configuração NextAuth v5                        |
| `src/lib/impersonate.ts`                            | Lógica de impersonação COORDINATOR→outros       |
| `src/shared/domain/policies/attendance-window-policy.ts` | Janelas de check-in/checkout (fonte única) |
| `src/shared/infra/rate-limit/index.ts`              | Rate limiter (in-memory, swappável por Redis)   |
| `docker-compose.dev.yml`                            | Postgres local na porta 5434                    |
| `src/db/seed-dev.ts`                                | Seed fake com @faker-js/faker (seed 42)         |
| `tests/`                                            | Suite de testes com node:test + tsx             |
| `AGENTS.md`                                         | Regras operacionais para agentes                |
| `docs/runtime-truth.md`                             | Verdade de produção                             |
| `docs/dev-agent-macbook.md`                         | Fluxo alternativo via Docker Compose para o app |
