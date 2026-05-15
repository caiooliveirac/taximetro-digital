# DEPLOY

Como o `taximetro-digital` chega em produção.

## Visão geral

- **Trigger**: push em `master` ou `workflow_dispatch` em `.github/workflows/deploy.yml`.
- **Modelo**: build *na própria VM de produção* (ARM64 nativo), com canário antes do swap.
- **Container alvo**: `taximetro-digital` em `127.0.0.1:3010` (proxy reverso Nginx para `https://mnrs.com.br/taximetro/*`).
- **Imagem**: Next.js standalone, `node:24-alpine`, multi-stage (`deps` → `builder` → `runner`).

## Fluxo de deploy (resumido)

1. **CI (`test` job)** — em runner GitHub: `npm ci` → `typecheck` → `test` → `build` com Node lido de `.nvmrc`.
2. **`db_changes` (opcional, manual)** — `workflow_dispatch` com `apply_db_changes=true`: roda `drizzle-kit push --force` + recria a materialized view `available_slots`. Não é disparado em push automático.
3. **`deploy` (após `test` verde)**:
    1. `rsync` do source para `/home/ubuntu/taximetro-digital` na VM.
    2. `docker build --pull -t taximetro-digital:candidate .`
    3. **Canário**: sobe `taximetro-digital-canary` na mesma rede com as mesmas envs e aguarda `GET /taximetro/api/health` retornar `healthy` em ≤45s.
    4. **Swap**: `docker rm -f taximetro-digital` → `docker run -d --name taximetro-digital ...` com a imagem `candidate`.
    5. **Verifica saúde** do container novo (`≤30s`).
    6. `sudo systemctl reload nginx` + smoke test via Nginx (`https://127.0.0.1/taximetro/login` deve retornar HTTP 200).
    7. Limpa o canário.

Se qualquer passo falhar (canário não-saudável, healthcheck, smoke), o workflow aborta e o container antigo **continua rodando** (não foi tocado até passar canário).

## Pré-requisitos na VM

- Docker, `psql`, `wget`, Nginx com TLS configurado.
- Diretório `/var/backups/taximetro` montado e gravável (cria automaticamente no deploy).
- Rede Docker `repo_default` existindo.
- Postgres no host acessível via `host.docker.internal` (`--add-host=host.docker.internal:host-gateway`).
- Secrets do GitHub: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN*`, `TELEGRAM_GROUP_ID`, `SMTP_*`, `DB_BACKUP_EMAIL_TO`.

## Build local equivalente

```bash
npm ci
npm run typecheck
npm test
npm run build
docker build --pull -t taximetro:candidate .
```

## Healthcheck

`GET /taximetro/api/health` valida envs críticas + ping no DB. Resposta `healthy` → OK.

## O que **não** muda em deploy

- Nome do container (`taximetro-digital`), rede (`repo_default`), volume (`/var/backups/taximetro`), porta (`127.0.0.1:3010`), basePath (`/taximetro`).
- Estado do Postgres no host (não tocamos volume).
- Migrations: nunca em deploy automático; só via `workflow_dispatch` com flag.

## Smoke pós-deploy

1. `https://mnrs.com.br/taximetro/login` retorna 200.
2. Login com COORDINATOR funciona.
3. `GET /taximetro/api/health` retorna `healthy`.
