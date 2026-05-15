# AI_PROJECT_UPGRADE_CONTEXT

Contexto compacto para modernização segura de runtime, dependências, Docker e deploy.
Gerado por auditoria em **2026-05-15**. Atualizar ao concluir cada camada.

---

## 1. Stack detectada

| Camada        | Tecnologia                                  |
|---------------|---------------------------------------------|
| Framework     | Next.js 15.5 (App Router, `output: standalone`, `basePath: /taximetro`) |
| UI            | React 19.2, Tailwind CSS 4.2, Radix UI, lucide-react |
| Linguagem     | TypeScript 5.9 (`strict: true`, `target: ES2017`) |
| ORM / DB      | Drizzle ORM 0.45 + drizzle-kit 0.31 / PostgreSQL 16 |
| Auth          | next-auth 5.0.0-beta.29 (Auth.js v5)        |
| Driver DB     | `postgres` 3.4                              |
| E-mail        | nodemailer 6.10                             |
| Telegram      | grammy 1.41 (webhook)                       |
| Package mgr   | npm (lockfileVersion 3)                     |
| Testes        | `node:test` + `tsx` (75 testes, baseline verde) |

## 2. Serviços detectados

- **App**: container Docker `taximetro-digital`, imagem Next.js standalone (`node server.js` via `scripts/container-entrypoint.sh`), publicada em `127.0.0.1:3010`.
- **Cron interno** (no entrypoint do container): backup diário de banco, lembrete Telegram, lifecycle de turmas.
- **Postgres**: na própria EC2 (host), acessado via `DATABASE_URL`. Dev: container `postgres:16-alpine` (`docker-compose.dev.yml`, porta 5436).
- **Nginx**: systemd no host, termina TLS do domínio e roteia `/taximetro/*` → `127.0.0.1:3010`.
- **CI/CD**: GitHub Actions (`ci.yml` em PR/branches; `deploy.yml` em push `master` — build na VM + canário + swap).
- Healthcheck: `GET /taximetro/api/health`.

## 3. Versões atuais

| Item                    | Atual                  | Observação |
|-------------------------|------------------------|------------|
| Node (Dockerfile)       | `node:20-alpine`       | Node 20 em fim de vida (EOL ~2026-04) |
| Node (docker-compose.dev) | `node:20-alpine`     | inconsistente |
| Node (CI / deploy.yml)  | `22`                   | inconsistente com Docker |
| Node (host dev)         | 24.8.0                 | — |
| `.nvmrc` / `engines`    | **ausentes**           | sem fonte única de versão |
| npm                     | 11.6 (host)            | bundled do Node na imagem |
| next                    | `15.5.13` (lock 15.5.15) | pin inconsistente |
| postcss (aninhado em next) | < 8.5.10            | vulnerável (moderate) |
| nodemailer              | 6.10.1                 | vulnerável (high) |

## 4. Versões alvo recomendadas

| Item              | Alvo            | Justificativa |
|-------------------|-----------------|---------------|
| Node              | **22 LTS** (`node:22-alpine`) | Active LTS, já validado na CI; unifica Docker = CI = dev |
| nodemailer        | **8.0.7**       | corrige 4 CVEs high (SMTP injection / DoS) |
| `@types/nodemailer` | 8.0.x         | acompanha nodemailer 8 |
| next              | **15.5.18+** (mesmo minor) | corrige postcss aninhado, sem breaking change |
| postcss / tailwindcss / @tailwindcss/postcss | minor mais recente (8.5.x / 4.3.x) | seguro |
| @aws-sdk/client-s3, tailwind-merge, tsx, zod, react/react-dom | patch/minor mais recente | seguro |
| `.nvmrc` + `engines.node` | `>=22 <23` | fonte única de versão |

**Adiado (major / breaking — fora desta rodada):** next 16, TypeScript 6, react-day-picker 10, lucide-react 1.x.

## 5. Riscos de migração

- **Node 20 → 22**: baixo. CI já compila em 22; é alinhar Docker à CI.
- **nodemailer 6 → 8**: baixo. Uso restrito a `createTransport` + `verify` + `sendMail` com Promises (`src/lib/email.ts`, `scripts/daily-db-backup.mjs`) — API estável entre 6 e 8.
- **next patch 15.5.13 → 15.5.18**: baixo, mesmo minor.
- **Deploy**: `docker build` sem `--pull` pode reaproveitar base antiga em cache; nomes de container/rede/volume (`taximetro-digital`, `repo_default`, `/var/backups/taximetro`) **não podem mudar**.
- **Banco**: nenhuma migration alterada; `drizzle-kit push --force` permanece manual via `workflow_dispatch`.

## 6. Comandos de build / test / deploy

```bash
# Local
npm ci
npm run typecheck
npm test
npm run build

# Docker (igual ao deploy)
docker build --pull -t taximetro:candidate .

# Auditoria
npm audit
```

## 7. Como validar localmente

1. `npm ci` — instalação limpa a partir do lockfile.
2. `npm run typecheck && npm test && npm run build`.
3. `docker build --pull -t taximetro:candidate .` — build da imagem.
4. `docker compose -f docker-compose.dev.yml config` — valida sintaxe do compose.
5. Subir container e checar `GET /taximetro/api/health` → `healthy`.

## 8. Rollback

- Código: `git revert` do(s) commit(s) da branch `chore/modernize-runtime-and-deps` ou não fazer merge.
- Runtime: a imagem anterior continua no host; recriar o container `taximetro-digital` a partir da última imagem boa (ver seção DEPLOY SEGURO no relatório final).
- O fluxo de deploy valida um **canário** antes do swap — uma imagem nova quebrada não substitui produção.

## 9. Decisões tomadas

- Manter **npm** (sem troca para pnpm/yarn).
- Manter **next-auth 5 beta** (decisão de arquitetura do projeto).
- Unificar Node em **22 LTS** (e não 24) para igualar Docker à CI já existente.
- Não usar compose para produção (decisão registrada em `docs/runtime-truth.md`).
- Não tocar migrations nem nomes de container/rede/volume.

## 10. Pendências

Concluído na branch `chore/modernize-runtime-and-deps` (2026-05-15):

- [x] Camada A — Node 20→24-alpine (Dockerfile, dev compose), `.nvmrc`, `engines`
- [x] Camada B — nodemailer 6→8.0.7, next 15.5.13→15.5.18, drizzle-orm patch
      (SQL injection HIGH), minors seguros; `overrides` p/ peer do next-auth
- [x] Camada D — `--pull` no `docker build` (deploy.yml)
- [x] Camada E — CI: `node-version-file: .nvmrc`, `npm audit --audit-level=high`,
      teste guardrail `tests/runtime-version.test.ts`

Resultado de segurança: **0 vulnerabilidades HIGH** (eram 5). Restam 7 moderate:

- `postcss` (<8.5.10): empacotado dentro do `next` — só sai com **next 16**.
- `next-auth` beta.29: aviso de "Email misdelivery" do provider de e-mail —
  **provider não usado** (app usa Credentials + Google). Sai ao subir next-auth estável.
- `esbuild`/`flatted` etc.: transitivos **dev-only** sob `drizzle-kit`/`eslint` —
  sem superfície em runtime de produção.

Adiado (major / breaking — exige análise dedicada):

- [ ] `next` 15.5 → 16.x (resolve o postcss aninhado)
- [ ] `typescript` 5.9 → 6.x
- [ ] `react-day-picker` 9 → 10
- [ ] `lucide-react` 0.577 → 1.x
- [ ] `next-auth` 5 beta → estável (quando publicado)
