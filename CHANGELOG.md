# Changelog

Todas as mudanças notáveis neste projeto estão documentadas aqui.
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/).

---

## [Unreleased]

### Adicionado
- **Montar Escala no menu do admin** — nova tela `/admin/montar-escala` (grupo Operação): é a mesma tela do líder — CRU fixo semanal + sorteio de intervenção nas bases USA — com um seletor de faculdade na frente, para o coordenador não precisar mais entrar por impersonate. O componente é um só (`src/components/scheduling/montar-escala.tsx`, movido de `src/app/leader/escala/page.tsx`); `/leader/escala` virou um wrapper de 3 linhas. A faculdade do líder continua vindo do vínculo; a do coordenador vem da tela e viaja em `facultyId` — a decisão de rota, query, corpo e cabeçalho fica em `escala-scope.ts` (`tests/escala-scope.test.ts`). Novas rotas `/api/admin/escala/{interns,lottery,cru-fixed,cru-generate}`, que reusam os casos de uso das rotas do líder e exigem COORDINATOR + faculdade (`src/lib/admin-escala.ts`, `tests/admin-escala-routes.test.ts`). Toda requisição da tela do admin manda `x-no-impersonate: 1`: o cookie de impersonate sobrevive à navegação e sem isso a faculdade escolhida seria silenciosamente trocada pela do líder visitado por último. Não confundir com a feature `adminLottery` (botão de sortear na Escala USA), que segue exclusiva da Vitalmed e inalterada.
- **Sorteio por turma na tela do líder** — o modal "Sortear Internos" (`/leader/escala`) passou a ter um seletor de turma. O líder com turma vinculada continua vendo só a dele; quem entra por impersonate de líder sem turma (o caso do COORDINATOR) recebia a faculdade inteira e agora abre o modal já recortado na turma que cruza a semana sorteada — em semana de virada vale a que começou depois. O recorte vale para o que vai ao servidor: interno de outra turma não entra no sorteio nem por seleção remanescente. Sem turma cruzando a semana (ou faculdade sem turma cadastrada), cai em "Todas as turmas" e nada muda em relação ao comportamento anterior. Regras em `src/features/scheduling/domain/policies/lottery-cohorts.ts` (`tests/lottery-cohorts.test.ts`); `/api/leader/interns` agora devolve também `cohortId` e `cohortLabel`.
- **Heatmap de presença para líderes** — a visão heatmap (antes exclusiva do admin/relatórios) agora está disponível na página `/leader/relatorios` para o líder autenticado. Exibe somente os internos da turma do líder (`cohortId` do token), é totalmente clicável (abre modal com detalhes do plantão) e respeita o mesmo período configurado pelos filtros de data. Novas rotas:
  - `GET /api/leader/heatmap?from=&to=` — gera o `ReportDocument` escopado à faculdade + turma do líder.
  - `GET /api/leader/assignments/[id]` — retorna detalhes do plantão; rejeita IDs fora da faculdade do líder (403).
  - Componente `Heatmap` exportado de `attendance-report-document.tsx` com prop `assignmentDetailPath` configurável (default: rota admin).

---

## [0.9.0] — 2026-04-22

### Corrigido
- **[CRÍTICO] Auth silenciosa em desenvolvimento** — `secureCookie: true` hardcoded em 18 arquivos (middleware, impersonate.ts e 16 API routes) fazia `getToken` retornar `null` em HTTP, causando redirect para `/login` mesmo com usuário autenticado e 401/403 em todas as APIs. Corrigido para `secureCookie: process.env.NODE_ENV === "production"`.

### Adicionado
- **Seed de desenvolvimento com Faker** — `seed-dev.ts` migrado para `@faker-js/faker` (locale `pt_BR`, `seed(42)` fixo) com proteção dupla contra produção: aborta se `NODE_ENV === "production"` ou se `DATABASE_URL` não aponta para host local. Escape hatch `SEED_DEV_FORCE=1` para staging controlado.
- **Gate de testes no CI** — job `test` (Node 22, `npm ci`, `npm test`) adicionado ao deploy workflow. O `deploy` só executa se os testes passarem.
- **`CLAUDE.md`** — guia de ambiente dev lido automaticamente pelo Claude Code: Docker Postgres porta 5434, template `.env.local`, credenciais de teste, `npm test`, estrutura de URLs, gotcha do `secureCookie`.

### Refatorado
- **Política de janelas de plantão centralizada** — `isUnifiedShiftCheckout` e `resolveCheckoutAssignmentIds` estavam copiados verbatim em `validate/route.ts` e `checkout/route.ts`. Movidos para `src/shared/domain/policies/attendance-window-policy.ts` como fonte única.
- **Rate limiter extraído** — lógica de sliding-window inline em `validate/route.ts` movida para `src/shared/infra/rate-limit/index.ts`. Interface pronta para troca por Redis sem alterar callers.
- **Dashboard repository** — 8+ queries SQL inline em `admin/page.tsx` (~240 linhas) extraídas para `src/features/reporting/infra/repositories/dashboard-query.ts`. Página reduzida a ~36 linhas de composição.
- **`logAudit` padronizado** — aceita `realUserId` como parâmetro de primeiro nível (antes cada rota injetava manualmente no payload com chaves inconsistentes: `impersonatedBy`, `impersonating`, `actingAs`).

---

## [0.8.0] — 2026-04-20

### Adicionado
- **Multi-role completo (Cortes A/B/C)** — usuários podem acumular papéis (ex: LEADER + INTERN, COORDINATOR + PRECEPTOR). JWT enriquecido com `roles[]` contendo `facultyId`/`baseId` por papel. RoleSwitcher no sidebar para trocar contexto. Guards nos endpoints de attendance respeitam o papel ativo.
- **Admin/usuarios com gestão multi-role** — UI com multi-select de papéis, diff-based updates, badges por papel.
- **Arquivamento de interns** — campo `is_archived` em `user_roles`. Interns arquivados não aparecem em pendências, sorteio ou notificações. Arquivamento automático sugerido após 21 dias sem atividade. Arquivamento em lote disponível para líderes.
- **Filtro de papéis em escala** — apenas usuários com papel `INTERN` são escaláveis. `LEADER-only` excluído do sorteio.

### Corrigido
- `PRECEPTOR` sem `baseId` é válido (preserva legado de preceptores sem base fixa).
- Líderes com `LEADER+INTERN` incluídos corretamente na lista de alocação.
- Telegram: `/pendencias` funciona fora do grupo oficial, aceita chat ID migrado.
- Scheduling: loteria aloca apenas bases `USA`; `CRU` fixo respeita alocação manual `CRL/USA`.

---

## [0.7.0] — 2026-04-10 a 2026-04-15

### Adicionado
- **Compliance por tipo de base** — metas segmentadas por tipo (USA/CRU/CRL), `rotation_start_date` por faculdade para filtrar pendências por período.
- **Telegram bot `/pendencias`** — líderes consultam déficit de presença pelo Telegram. Comando com projeção de agendados, destaque de falta sem justificativa.
- **Backup diário de banco** — cron `37 3 * * *` com script `daily-db-backup.mjs`.

### Corrigido
- Erros de conexão e remoção silenciosa em plantões retroativos.
- Filtro de arquivados em pendências + seção "candidatos a arquivamento" com último plantão.
- Cálculo de déficit histórico por tipo com projeção de agendados.

---

## [0.6.0] — 2026-03-01 a 2026-04-09

### Adicionado
- **Sistema de impersonation** — COORDINATOR pode visualizar e agir como qualquer usuário (LEADER, PRECEPTOR, INTERN) via cookie/header `x-impersonate-user`. Todas as ações auditadas com `realUserId`.
- **Sistema de solicitações (swap/extra/drop)** — interns solicitam trocas, plantões extras e desistências. Líderes aprovam/rejeitam. Histórico por usuário.
- **Notificações Telegram** — lembretes de check-in pendente às 8h/9h via webhook. Cron configurado no entrypoint do container.
- **Invite links** — geração de links de convite com papel-alvo (COORDINATOR, LEADER, PRECEPTOR, INTERN).
- **OAuth Google + redefinição de senha** — fluxo completo com nodemailer. SMTP configurável via env.
- **Vagas CRU/EBMSP** — regras de vagas para Central de Regulação com capacidade por dia da semana.
- **Loteria + alocação manual** — round-robin com `maxShifts` por faculdade. Líderes removem interns de plantões com confirmação + auditoria.
- **Observações de presença** — preceptores registram observações por checkin.

### Corrigido
- `basePath: /taximetro` em todos os redirects NextAuth e links de e-mail.
- Conflito ±12h entre plantões bloqueado na alocação.
- Foto de registro com opção câmera/galeria.

---

## [0.5.0] — inicial (antes de 2026-03-01)

### Adicionado
- Fluxo de check-in/checkout por QR code com TOTP (5 min, sessão 15 min).
- Validação via Telegram: preceptor recebe código TOTP, valida no app.
- Geofence por base (`geoFenceMeters`).
- Dashboard admin com KPIs de presença.
- Escala de plantões com visualização semanal.
- Roles: COORDINATOR, LEADER, PRECEPTOR, INTERN.
- Deploy via GitHub Actions com canary healthcheck antes de substituir container de produção.
