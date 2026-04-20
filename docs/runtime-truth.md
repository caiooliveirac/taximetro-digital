# Runtime Truth

Este documento define o que manda de verdade em producao para evitar diagnostico incorreto por agentes.
Se houver divergencia entre documentacao antiga e este arquivo, este arquivo prevalece.

## 0. Pontos operacionais minimos

- `basePath` oficial da app: `/taximetro` (fonte: [next.config.ts](../next.config.ts))
- Job de reminder Telegram: [scripts/trigger-telegram-checkin-pending-reminder.mjs](../scripts/trigger-telegram-checkin-pending-reminder.mjs)
  - Endpoint valido em producao: `/taximetro/api/telegram/checkin-pending-reminder`
  - Nao assumir `/api/telegram/checkin-pending-reminder` como fallback funcional sem evidencia runtime
- Deploy manual resumido (quando necessario fora do GHA):
  1. Build da imagem
  2. Recriar `taximetro-digital` com `.env` e `DATABASE_URL` valido para runtime
  3. Validar health interno
  4. Validar rota externa via Nginx
- Papel do Nginx externo: terminar trafego do dominio e rotear `/taximetro/*` para `taximetro-digital:3000`
- Validacao minima de healthcheck:
  - Interno: `wget -q -O- http://127.0.0.1:3000/taximetro/api/health` dentro do container
  - Externo: `curl -sk -o /dev/null -w "%{http_code}" "https://127.0.0.1/taximetro/login" -H "Host: mnrs.com.br"`
- Validacao minima de migrations:
  - Aplicacao: `npx drizzle-kit push --force` em runtime builder com `DATABASE_URL` de producao
  - Criterio de sucesso: comando finaliza sem erro e app sobe com health `healthy`

## 1. Processo oficial que sobe a app

- Processo oficial: container Docker `taximetro-digital`
- Build oficial: `docker build` com [Dockerfile](../Dockerfile)
- Runtime final: imagem Next.js standalone executando `node server.js` via entrypoint
- Entrypoint oficial: [scripts/container-entrypoint.sh](../scripts/container-entrypoint.sh)

## 2. Processo oficial que atende o dominio

- O dominio e atendido por Nginx service instalado no host da VM (systemd)
- O Nginx roteia `/taximetro/*` para `127.0.0.1:3010` (container `taximetro-digital` publicado em loopback)
- A app oficial usa `basePath` `/taximetro`

## 3. Banco oficial

- Banco oficial: PostgreSQL na EC2
- A app acessa o banco pela `DATABASE_URL` injetada no container
- Em runtime containerizado, nao assumir `localhost` como host do banco da VM

## 4. Webhook vs polling

- Telegram inbound oficial: webhook HTTP em [src/app/api/telegram/webhook/route.ts](../src/app/api/telegram/webhook/route.ts)
- Polling de Telegram: nao oficial e nao deve estar ativo
- Atualizacao de status de presenca para UI: SSE com polling interno de banco a cada 5s em [src/app/api/attendance/status/[assignmentId]/route.ts](../src/app/api/attendance/status/[assignmentId]/route.ts)

Resumo operacional:
- Telegram: webhook
- Status em tempo real na UI: SSE com polling interno do DB

## 5. Jobs cron oficiais

Cron e configurado dentro do container da app no entrypoint.

Jobs oficiais:
- Backup diario de banco
  - Script: [scripts/daily-db-backup.mjs](../scripts/daily-db-backup.mjs)
  - Schedule default: `37 3 * * *`
- Lembrete Telegram de check-in pendente
  - Script: [scripts/trigger-telegram-checkin-pending-reminder.mjs](../scripts/trigger-telegram-checkin-pending-reminder.mjs)
  - Schedule default: `0 8,9 * * *`

## 6. Fluxo de deploy oficial (real)

Fluxo oficial: GitHub Actions

Arquivo oficial:
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)

Sequencia real:
1. Push em `master` dispara workflow
2. Workflow envia codigo para VM
3. Build da imagem Docker da app
4. Recriacao do container `taximetro-digital`
5. Execucao de migration/seed via imagem builder
6. Healthcheck interno da app
7. Reload do Nginx

## 7. Padrão de Usuários e Papéis (Desde 2026-04-20)

**Internos arquivados**: Campo `user_roles.is_archived = true`
- NÃO aparecem em listas de pendências
- NÃO aparecem em sorteio/alocação
- NÃO recebem notificações
- Dados preservados em auditoria

**Padrão de papéis em scheduling**:
- Apenas usuários com papel `INTERN` podem ser alocados
- Líderes com papel `LEADER` only → NÃO escaláveis (ex: ZARNS)
- Líderes com papel `LEADER + INTERN` → escaláveis (ex: UNIFACS)

Ver [docs/role-filtering.md](role-filtering.md) e [docs/CHANGES-2026-04-20.md](CHANGES-2026-04-20.md) para detalhes.
8. Smoke test de roteamento

## 7. Legado e o que nao deve estar rodando

Legado ou nao-oficial para este repo:
- PM2 para subir a app: nao oficial
- `docker-compose` para producao da app: nao oficial neste repositorio
- Polling de Telegram (long polling): nao oficial
- Subir Next.js via `npm run start` fora de container em producao: nao oficial

## 8. Regras de decisao para agentes

Antes de qualquer analise/correcao:
1. Confirmar container `taximetro-digital` ativo
2. Confirmar health interno (`/taximetro/api/health`)
3. Confirmar rota externa via Nginx (`/taximetro/...`)
4. Confirmar que a hipotese usa o fluxo oficial acima
5. Se a hipotese depender de runtime legado, marcar como risco de diagnostico incorreto

## 9. Fonte de verdade operacional

Arquivos que devem guiar a analise primeiro:
- [AGENTS.md](../AGENTS.md)
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)
- [Dockerfile](../Dockerfile)
- [scripts/container-entrypoint.sh](../scripts/container-entrypoint.sh)
- [next.config.ts](../next.config.ts)

Ultima atualizacao: 2026-04-10
