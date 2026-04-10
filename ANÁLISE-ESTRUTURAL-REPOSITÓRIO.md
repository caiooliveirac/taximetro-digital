# Análise Estrutural — Taxímetro Digital

**Data:** 10 de abril de 2026  
**Modo:** Read-only — Exploração de sistema atual  
**Objetivo:** Mapear arquitetura real e identificar fragilidades antes de qualquer mudança

---

## 1. Resumo Executivo

### Postura Atual
O Taxímetro Digital é um **sistema em produção estável com complexidade moderada**: 46 rotas de API, 14 tabelas PostgreSQL, arquitetura por features já parcialmente refatorada, e múltiplas integrações externas (Telegram, email, OAuth).

### Saúde Estrutural
- ✅ **Stack coeso**: Next.js 15 + React 19 + NextAuth 5-beta + Drizzle 0.45 + PostgreSQL 16
- ✅ **Deploy reproducível**: GitHub Actions + Docker multi-stage + migrations automáticas
- ✅ **Auditoria ponta-a-ponta**: todas as ações críticas logadas com usuário real e impersonação
- ✅ **Anti-fraude multifalor**: geolocalização + TOTP + validação por preceptor
- ⚠️ **Áreas de risco**: rate limiting em memória, fallbacks de DATABASE_URL, configuração de crons condicional, paths duplicados
- ⚠️ **Documentação**: parcialmente atrasada vs código (docs/ descreve intenção, nem sempre realidade)

### Prognóstico
Sistema pronto para mudanças localizadas com **risco baixo-a-moderado** se as regras operacionais da seção 6 forem seguidas.

---

## 2. Arquitetura Real Encontrada

### 2.1 Stack Tecnológico Confirmado
```
Camada de Entrada:       Next.js 15.5.13 (App Router, output=standalone)
UI Runtime:              React 19.2.4
Validação:               Zod 4.3.6
Autenticação:            NextAuth.js 5.0-beta.29 (JWT, Credentials, Google OAuth)
ORM:                     Drizzle ORM 0.45.1
Banco:                   PostgreSQL 16 (host.docker.internal em produção)
Bot Externo:             grammY 1.41.1 (Telegram API)
Anti-Fraude:             otplib 13.4.0 (TOTP RFC 6238), qrcode 1.5.4
Email:                   nodemailer 6.10.1 (SMTP)
UI Components:           Radix UI + shadcn/ui
CSS:                     Tailwind CSS 4.2.1
Runtime:                 Node.js 20 (Alpine Linux)
Container Orchestration: Docker (multi-stage, Alpine base)
Build/Deploy:            GitHub Actions + rsync + SSH
```

### 2.2 Pontos de Entrada Identificados

#### Públicos (sem autenticação)
- `GET /login` → renderiza form Credentials + Google OAuth
- `GET /esqueci-senha`, `POST /api/auth/callback/credentials` → fluxo reset senha
- `GET /registro` → self-registration via convite
- `POST /api/telegram/webhook` → webhook webhook do bot (validações internas)
- `GET /api/health` → health check (sem auth)
- `POST /api/auth/*` → NextAuth routes (manejo de sessão JWT)

#### Autenticados por Papel (via middleware)
- `COORDINATOR` → `/admin/*` (acesso universal, impersonação)
- `LEADER` → `/leader/*` (gerenciamento de faculdade + internos)
- `PRECEPTOR` → `/preceptor/*` (validação de presença)
- `INTERN` → `/intern/*` (check-in/checkout/requisições)

#### Crons Internos (docker entrypoint)
- `DB_BACKUP_CRON` (padrão `37 3 * * *`) → backup diário PostgreSQL
- `TELEGRAM_CHECKIN_REMINDER_CRON` (padrão `0 8,9 * * *`) → reminder de pendências → `/taximetro/api/telegram/checkin-pending-reminder`

### 2.3 Fluxo de Runtime em Produção

```
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions (deploy.yml)                                │
│ - Rsync fonte → EC2                                         │
│ - Docker build (ARM64 nativo)                               │
│ - Migrations (drizzle-kit push --force)                     │
│ - Seed idempotente (seed.ts)                                │
│ - Container start + healthcheck (30s timeout)               │
│ - Nginx reload                                              │
└─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ Container Produção (taximetro-digital:deploy-*)             │
│ - Rede Docker: repo_default                                 │
│ - DATABASE_URL injetado via secrets                         │
│ - PORT=3000                                                 │
│ - TZ=America/Bahia                                          │
│ - entrypoint: scripts/container-entrypoint.sh               │
│   → init cron environment (.cron-env.sh)                    │
│   → append_backup_cron + append_reminder_cron               │
│   → crond (daemon)                                          │
│   → exec node server.js (Next.js standalone)                │
└─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ Nginx Externo (repo-nginx-1)                                │
│ - Porta 80/443 (host)                                       │
│ - Domain mnrs.com.br                                        │
│ - Upstream app_taximetro → taximetro-digital:3000           │
│ - Location /taximetro/* → proxy_pass para app               │
│ - X-Forwarded-* headers                                     │
│ - HSTS (max-age=31536000)                                   │
└─────────────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────────────┐
│ Banco PostgreSQL (EC2 host)                                 │
│ - Port 5432                                                 │
│ - Backup diário → /var/backups/taximetro/*.dump             │
│ - Retenção 14 dias                                          │
│ - Email opcional                                            │
└─────────────────────────────────────────────────────────────┘
```

### 2.4 Estrutura de Código Encontrada

```
src/
  ├── app/                           # Next.js App Router
  │   ├── (auth)/                    # Públicas (login, reset senha)
  │   ├── admin/, leader/, preceptor/, intern/  # Por papel
  │   ├── api/
  │   │   ├── auth/[...nextauth]/    # NextAuth handler
  │   │   ├── admin/                 # 11 rotas (users, bases, rules, audit, etc)
  │   │   ├── attendance/            # 5 rotas (checkin, validate, checkout, current, observations)
  │   │   ├── assignments/           # crud + update status
  │   │   ├── requests/              # swap, extra, drop
  │   │   ├── slots/                 # available slots
  │   │   ├── telegram/              # webhook + reminder
  │   │   ├── health/                # healthcheck
  │   │   └── ... (14 mais pastas)   # compliance, case-records, etc
  │   ├── trocar-senha/              # Force password change
  │   └── middleware.ts              # RBAC + session validation
  │
  ├── features/                      # Domain-driven feature folders
  │   ├── scheduling/
  │   │   ├── application/use-cases/
  │   │   ├── domain/policies/
  │   │   ├── infra/repositories/
  │   │   └── ui/
  │   ├── requests/
  │   ├── admin-attendance/
  │   ├── case-records/
  │   ├── user-management/
  │   └── ... (11 mais)
  │
  ├── lib/                           # Shared logic
  │   ├── auth.ts                    # NextAuth + providers config
  │   ├── telegram.ts                # Bot init (TELEGRAM_BOT_TOKEN_NEXT priority)
  │   ├── email.ts                   # SMTP transporter + error handling
  │   ├── totp.ts                    # TOTP generation + validation
  │   ├── geo.ts                     # Haversine distance + geofence
  │   ├── impersonate.ts             # Coordinator impersonation
  │   ├── telegram-checkin-pending-reminder.ts
  │   ├── slots.ts                   # Slot availability checking
  │   ├── utils.ts                   # formatHour, validateShiftClockIn, etc
  │   ├── sse.ts                     # Server-sent events setup
  │   └── ...
  │
  ├── components/                    # UI Components
  │   ├── admin-dashboard.tsx        # KPI dashboards (complex)
  │   ├── admin-filled-schedule.tsx  # Schedule visualization
  │   ├── app-sidebar.tsx
  │   └── ... (30+ componentes)
  │
  ├── db/
  │   ├── schema.ts                  # Drizzle schema (14 tabelas, enums)
  │   ├── index.ts                   # Drizzle client
  │   ├── seed.ts                    # Bases + faculties + admin user
  │   ├── seed-dev.ts                # 50+ dev users com assignments simulados
  │   ├── seed-prod.ts               # Production-like data (100+ usuarios, histórico de 30 dias)
  │   └── ...
  │
  ├── shared/                        # Utilities & constants
  │   └── infra/logger/audit.ts      # Centralized audit logging
  │
  └── types/                         # TS type exports

scripts/
  ├── container-entrypoint.sh        # Init cron + migrate + seed + start app
  ├── daily-db-backup.mjs            # pg_dump + retention + email
  ├── trigger-telegram-checkin-pending-reminder.mjs  # Cron trigger
  └── gen-icons.js                   # PWA placeholder icons

drizzle/
  ├── migrations/                    # 10 migration files (SQL)
  └── _journal.json

docs/
  ├── architecture.md                # FASE 1-2-3 (estrutura alvo)
  ├── data-flow.md                   # Flow diagrams (parcialmente atualizado)
  ├── features.md                    # Feature map (confiável)
  └── runtime-truth.md               # Operational single source of truth

.github/workflows/
  └── deploy.yml                     # Concurrency, rsync, docker build, migrations, healthcheck, nginx reload

next.config.ts                       # basePath="/taximetro" + assetPrefix + HSTS headers
drizzle.config.ts                    # Schema + migrations out dir
tsconfig.json                        # strict mode
package.json                         # build, start, db:* scripts, dependencies
.env.example                         # Template de env vars (sem valores reais)
```

---

## 3. Fontes de Verdade do Sistema

### 3.1 Configuração Oficial

| Verdade | Fonte | Status | Confiabilidade |
|---------|--------|--------|---|
| **basePath** da app | `next.config.ts:4` | `/taximetro` | ✅ Autoritativa (impossível mudar sem quebrar) |
| **Integrações** | `package.json` / `.env.example` | Telegram, SMTP, Google OAuth | ✅ Alto |
| **Schema banco** | `src/db/schema.ts` | 14 tabelas + 8 enums | ✅ Alto (Drizzle força tipagem) |
| **Migrations** | `drizzle/*.sql` | 10 migrations (SQL puro) | ✅ Alto (aplicadas antes de start) |
| **Seed oficial** | `src/db/seed.ts` | Bases + faculties + admin user | ✅ Alto (executada em deploy) |
| **Seed dev** | `src/db/seed-dev.ts` | 50+ usuários, assignments | ⚠️ Parcial (pode ficar desatualizado) |
| **Rotas de API** | `src/app/api/**/route.ts` (46 arquivos) | Handlerss | ✅ Obrigatória (sem arquivo = sem rota) |
| **Middleware/auth** | `src/middleware.ts` | RBAC por role + force password change | ✅ Obrigatória (aplicado a toda navegação) |
| **Deploy** | `.github/workflows/deploy.yml` | Build → migrate → seed → start → healthcheck | ✅ Obrigatória (único caminho official) |
| **Documentação viva** | `docs/runtime-truth.md` | basePath, endpoints, deploy steps, health validation | ✅ Recém-criada (confiável) |

### 3.2 Variáveis de Ambiente Críticas

**Injetadas pelo GitHub Actions:**
```
DATABASE_URL          (secrets.DATABASE_URL)
AUTH_SECRET           (secrets.AUTH_SECRET)
AUTH_URL              (literal "https://mnrs.com.br")
GOOGLE_CLIENT_ID      (secrets)
GOOGLE_CLIENT_SECRET  (secrets)
TELEGRAM_BOT_TOKEN_NEXT  (secrets — preferência)
TELEGRAM_BOT_TOKEN    (secrets — legacy fallback)
TELEGRAM_GROUP_ID     (secrets)
SMTP_* (5 vars)       (secrets)
```

**Padrões no Container:**
```
PORT=3000             (hardcoded no Dockerfile)
NODE_ENV=production   (hardcoded)
HOSTNAME=0.0.0.0      (hardcoded)
TZ=America/Bahia      (Dockerfile EV, pode sobrescrever)
```

**Condicionais para Crons:**
```
DB_BACKUP_ENABLED     (default: true)
DB_BACKUP_CRON        (default: "37 3 * * *")
TELEGRAM_CHECKIN_REMINDER_ENABLED  (default: true)
TELEGRAM_CHECKIN_REMINDER_CRON     (default: "0 8,9 * * *")
```

### 3.3 Documentação de Referência Recomendada

1. **Runtime Truth** → [docs/runtime-truth.md](docs/runtime-truth.md)
   - Seção 0: pontos operacionais mínimos (basePath, reminder endpoint, deploy, nginx, health, migrations)
   - Seções 1-9: arquitetura de runtime, componentes, crons, webhooks

2. **Architecture** → [docs/architecture.md](docs/architecture.md)
   - FASE 1: diagnóstico do estado atual (problemas estruturais)
   - FASE 2: proposta de arquitetura alvo (features com domínios)
   - FASE 3: plano de migração (não implementado)

3. **Features** → [docs/features.md](docs/features.md)
   - Mapa de funcionalidades atuais por domínio
   - Entidades de dados envolvidas em cada feature
   - Integrações externas

4. **AGENTS.md** → [AGENTS.md](AGENTS.md)
   - Regras operacionais para agentes de IA
   - Postura de read-only-first, regression risk mapping, deploy gates
   - Secrets hygiene, communication, decision flowActual

5. **Análise Path Reminder** → [ANÁLISE-PATH-REMINDER.md](ANÁLISE-PATH-REMINDER.md)
   - Diagnóstico de ambiguidade de routing
   - Fallback desnecessário identificado

---

## 4. Ambiguidades, Fragilidades e Riscos

### 4.1 Zona Vermelha (Alto Risco de Regressão)

#### 1. **Rate Limiting em Memória** (src/app/api/attendance/validate/route.ts:18-23)
```typescript
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
```
**Problema:** Não persistido. Em deploy com múltiplos hashes/scalability:
- Rate limit "perdido" se container reinicia
- Inefetivo em multi-container (cada container tem seu Map)
- Preceptor validation (crítico) pode ser contornado em farming

**Risco:** Fraude de validação em massa  
**Impacto:** Validações falsas podem inflar attendance rates

**Recomendação:** Migrar para Redis ou banco (baixa prioridade em single-container)

#### 2. **basePath="/taximetro" Acoplado em Todos os Fetches**
- ✅ Todos os client-side fetches explicitamente incluem `/taximetro/` (correto)
- ⚠️ **Mas**: Qualquer mudança em next.config.tsLine 4 quebra rotas sem aviso
- ⚠️ **Teste de regressão ausente** para verificar consistency

**Exemplo:** Se alguém mudar `basePath: "/taximetro"` para `basePath: "/app"`:
- Build passa, deploy corre, **mas todas as requisições client retornam 404**
- Health check não detecta (usa `/taximetro/api/health` hardcoded)

**Risco:** Silent failure → Black screen in production  
**Recomendação:** Adicionar test que valida `next.config.ts` basePath contra conhecidos paths em codebase (rápido)

#### 3. **Token Rotation Dual-Variable (TELEGRAM_BOT_TOKEN_NEXT vs TELEGRAM_BOT_TOKEN)**
**Localização:** `src/lib/telegram.ts:4-5`, `scripts/container-entrypoint.sh:53`
```typescript
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN_NEXT?.trim() ||
  process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
```
**Problema:** Funciona, mas cria gotcha durante rotação:
- Se `TELEGRAM_BOT_TOKEN_NEXT` inválido → fallback silencioso a `TELEGRAM_BOT_TOKEN` antigo
- Não há alerta se ambos estão vazios (bot iniciará "disabled")
- Container-entrypoint disabilita cron se bot vazio (silenciosamente)

**Risco:** Falha silenciosa de notificações Telegram  
**Impacto:** Internos não recebem avisos de pendências sem saber que sistema falhou
**Recomendação:** Log explícito: "TELEGRAM_BOT_TOKEN_NEXT empty, using legacy" (com aviso visual)

#### 4. **Impersonation Feature sem Revogação**
**Localização:** `src/lib/impersonate.ts`, `src/app/api/attendance/validate/route.ts`
```typescript
const impersonating = isImpersonating(req, token);
const validatorId = user.realUserId ?? user.id;
```
**Problema:** Coordinator pode se passar por qualquer usuário indefinidamente
- Cookie `x-impersonate-user` pode ser setSilently (não há UI clear/revoke)
- Auditoria registra "impersonating: <realId>" mas sem revogação automática
- Se Coordinator's token vazado → unlimited impersonation possível

**Risco:** Fraude de validação de check-in por Coordinator malicioso  
**Impacto:** Um Coordinator comprometido pode validar absences falsamente
**Recomendação:** 
- Adicionar session/timing limit para impersonation (ex: max 1 hora)
- UI para "End Impersonation" explícita

#### 5. **Crons Condicionais com Lógica Complexa** (scripts/container-entrypoint.sh:48-60)
```bash
if [ "${TELEGRAM_CHECKIN_REMINDER_ENABLED:-true}" = "false" ]; then
  echo "[entrypoint] ... desabilitado por ENV"
elif [ -z "${TELEGRAM_BOT_TOKEN_NEXT:-${TELEGRAM_BOT_TOKEN:-}}" ]; then
  echo "[entrypoint] ... desabilitado por configuração incompleta"
else
  append_telegram_checkin_reminder_cron
fi
```
**Problema:** 
- Lógica condicional no script de init (não em app config)
- Nenhuma UI/flag central para desabilitar crons
- Se variável de env é limpa em runtime via docker update, cron pré-existing roda (código e realidade divergem)

**Risco:** Crons inesperados disparando, ou crons esperados não rodando  
**Impacto:** Internos não recebem alertas no horário correto
**Recomendação:** Passar `TELEGRAM_CHECKIN_REMINDER_ENABLED` como env var do app, não só de init

#### 6. **PWA Icons Placeholder**  (scripts/gen-icons.js)
```javascript
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
```
**Problema:** Imagem 1x1 navy blue placeholder para PWA
- Não há comentário indicando "usar em produção com ícone real"
- Se alguém clicar em "Instalar app", receberá ícone minúsculo azul

**Risco:** UX ruim se app é instalado como PWA  
**Impacto:** Mínimo (visual apenas), mas confusão
**Recomendação:** Comentário claro "TODO: Replace with real 192x192 and 512x512 PNGs before production"

### 4.2 Zona Amarela (Risco Moderado)

#### 7. **DATABASE_URL Fallback com localhost** (5 arquivos)
```
drizzle.config.ts:6
src/db/seed.ts:7
src/db/seed-dev.ts:32
src/db/seed-prod.ts:21
src/db/fix-coords.ts:6
```
**Problema:** Todos replicam o mesmo fallback:
```typescript
const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/taximetro";
```
- Bom para dev local
- ⚠️ Perigoso em scripts: se DATABASE_URL não setado, scripts se conectam a **localhost** silenciosamente
- Se alguém roda `npx tsx src/db/fix-coords.ts` na EC2 sem ENV, modifica banco **local** (não existe)

**Risco:** Confusão em runtime, possível alteração da DB errada  
**Impacto:** Dados de dev locais podem ser confundidos com upstream
**Recomendação:** Centralizar em `src/db/get-connection.ts` com validação explícita de produção

#### 8. **Seed Scripts Podem Conflitar**
```
npm run db:seed          → src/db/seed.ts (bases + faculties + admin)
npm run db:seed-dev      → src/db/seed-dev.ts (dev users + assignments)
npm run db:seed-prod     → src/db/seed-prod.ts (production users + months of data)
npm run db:reset         → clean-dev + seed + seed-dev
```
**Problema:** Nada impede rodar `db:seed-prod` em dev ou vice-versa
- Sem proteção de `NODE_ENV` nas seeds
- Se alguém roda `npm run db:reset` localmente, depois deploy, dados dev podem vazar para produção

**Risco:** Dados incorretos em banco  
**Impacto:** Usuários fake/demo em produção
**Recomendação:** Seeds devem checar `NODE_ENV` ou ficar no Dockerfile, não npm scripts

#### 9. **Email Gateway Soft Failure**
**Localização:** `src/lib/email.ts:44-100`
```typescript
if (!host || !portRaw || !user || !pass) {
  throw new EmailDeliveryError("SMTP_NOT_CONFIGURED", ...);
}
```
**Problema:** Se SMTP não está configurado:
- Reset password form aceitará entrada
- Backend retornará erro 500
- Usuário nunca sabe que reset link não foi enviado

**Risco:** Usuário pensa que fez reset, mas nunca recebe email  
**Impacto:** Acesso bloqueado indefinidamente
**Recomendação:** UI deve validar antecipadamente que SMTP está ok (health endpoint incluir smtp status)

#### 10. **Documentação Out-of-Sync**
**Localização:** docs/data-flow.md vs código atual
**Exemplo:** 
```markdown
// docs/data-flow.md menciona PM2 deployment (linha 35)
// mas código real usa Docker container (em GitHub Actions)
```
**Problema:**
- docs/architecture.md descreve FASE 2/3 (não implementadas)
- README menciona "desenvolvimento local" mas app é oficialmente deployada em Docker
- Fluxogramas em data-flow.md podem estar estranhos vs realidade

**Risco:** Agentes de IA seguindo docs estranhas  
**Impacto:** Alguém tenta deploy via PM2 em vez de Docker
**Recomendação:** Manter docs/runtime-truth.md como **única fonte de verdade** para operações

### 4.3 Código Legacy/Obscuro

#### 11. **instrucoes-checkin-qrcode-telegram.md** (641 linhas)
- Arquivo Markdown imenso com instruções técnicas de implementação
- Referencia `NEXT_PUBLIC_TELEGRAM_GROUP_USERNAME` que **não existe** em .env.example
- Parece ser documento de especificação, não documentação final

**Tipo:** Debt técnico — especificação incompleta
**Risco:** Alguém segue arquivo antigo, implementa feature duplicada

#### 12. **src/db/fix-coords.ts**
Script de "atualização de coordenadas das bases"
- Comentário: "Seguro para rodar em produção"
- **Problema:** Não há gate; qualquer dev pode rodar `npx tsx src/db/fix-coords.ts` e alterar todas as bases

**Risco:** Coordenadas geo alteradas silenciosamente (afeta geofence)
**Recomendação:** Script de admin/operação, não npm script

---

## 5. Áreas Mais Sensíveis a Regressão

### Criticidade 🔴 MUITO ALTA

1. **Attendance (Check-in/Validate/Checkout)**
   - 5 rotas interdependentes (checkin, validate, checkout, current, observations)
   - TOTP + geofence + rate limiting combinados
   - Tração com SSE em tempo real
   - **Risco:** Quebra de qualquer validação permite entrada falsa
   - **Regressão:** Teste E2E end-to-end (scripts/test-e2e.py)

2. **Autenticação e Autorização**
   - NextAuth (JWT), Credentials provider, Google OAuth, role-based middleware
   - Impersonation feature (COORDINATOR can act as someone)
   - Force password change flow
   - **Risco:** Bypass de auth = acesso não-autorizado
   - **Regressão:** Unit tests + live auth flow (reset password, 2FA simulation)

3. **basePath="/taximetro" Routing**
   - 46 rotas esperando `/taximetro/` prefix
   - Client-side retries dependem deste path (via middleware.ts)
   - Nginx upstream específico para `/taximetro -> container:3000`
   - **Risco:** URL rota quebrada = 404 em produção
   - **Regressão:** Smoke test após deploy (health + login page + API health)

4. **Database Migrations & Schema**
   - 10 migrations SQL (sequential, pode ter dependências)
   - Drizzle schema com constraints (unique, indexes, foreign keys)
   - Seed data (bases, faculties) que outras entidades referenciam
   - **Risco:** Migration falha = deploy bloqueado
   - **Regressão:** Testar migrations em DB limpo (CI pipeline)

### Criticidade 🟡 MODERADA

5. **Scheduling/Slot Rules (Escala)**
   - Complex CRU conflict detection (em `src/lib/cru-fixed.ts`)
   - Capacity checking + overflow rules
   - Role restrictions (LEADER vs COORDINATOR)
   - **Risco:** Slot allocation incorreta = schedule inválido
   - **Regressão:** Unit tests para conflict detection

6. **Telegram Integration**
   - Bot initialization com token (prioridade NEXT > legacy)
   - Webhook validation (apenas TELEGRAM_GROUP_ID acessa)
   - Cron reminder (endpoints `/taximetro/api/telegram/checkin-pending-reminder`)
   - **Risco:** Token inválido ou webhook quebrada = bot mudo
   - **Regressão:** Validar token periodicamente (health check)

7. **Email Service**
   - Password reset journey (usuario → esqueci-senha → email → link → trocar-senha)
   - SMTP config soft-fail (erro silencioso)
   - **Risco:** Reset links não enviados, usuários locked out
   - **Regressão:** E2E de reset password com mock SMTP

8. **Audit Logging**
   - Todas as ações críticas logadas (login, check-in, merge users, impersonation)
   - Usado para compliance/trailing
   - **Risco:** Logs incompletos = impossível auditar fraude
   - **Regressão:** Verificar que ações críticas tem auditoryAuditada

### Criticidade 🟢 BAIXA

9. **UI/UX Components**
   - Dashboard, forms, Tailwind styling
   - **Risco:** Visual quebrado (baixo impacto funcional)
   - **Regressão:** Screenshot tests (opcional)

10. **Util Scripts**
    - gen-icons.js (PWA placeholder)
    - test-e2e.py (teste manual)
    - **Risco:** Baixo
    - **Regressão:** Não essencial

---

## 6. Recomendações para AGENTS.md

Baseado no análise, AGENTS.md deve incluir **explicitamente**:

### 6.1 Verdades Operacionais Obrigatórias

```markdown
## Verdades Obrigatórias

1. **basePath Imutável**: `basePath: "/taximetro"` em next.config.ts é configuração oficial.
   - Todos os fetches client DEVEM incluir `/taximetro/` prefix.
   - Rota sem `/taximetro/` prefixo retorna 404 (não caem em fallback).
   - Se mudar basePath sem atualizar todas as rotas → silent 404 em produção.

2. **Autenticação é Máquina de Estados**:
   - Middleware valida AUTH_SECRET (Next Auth JWT).
   - Força mudança de senha com COORDINATOR override.
   - Impersonation é feature, não bug (auditada explicitamente).
   - Google OAuth depende de GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (GitHub Secrets).

3. **Rate Limiting em Memória**:
   - Validation endpoint tem rate limit local (10 tentativas/60s por usuário).
   - Em multi-container, não funciona (cada container tem seu Map).
   - NÃO é proteção contra farm, só proteção básica.

4. **Database Migrations são Sequenciais**:
   - Deploy roda `drizzle-kit push --force` ANTES do start.
   - Se migration falha → container não sobe.
   - Seed.ts (bases + faculties + admin) roda DEPOIS das migrations.

5. **Crons Rodam Dentro do Container**:
   - `container-entrypoint.sh` inicia crond daemon (não systemd/supervisor outside).
   - Crons estão em crond, não em agendador externo (EC2 cron, PM2, etc.).
   - Crons podem ser desabilitados por ENV vars (DB_BACKUP_ENABLED, TELEGRAM_CHECKIN_REMINDER_ENABLED).
   - Se ENV omitido, padrão é `true` (crons ligados).

6. **Telegram Bot Token Rotation**:
   - Prefere TELEGRAM_BOT_TOKEN_NEXT (novo), fallback a TELEGRAM_BOT_TOKEN (legado).
   - Se ambos vazios → bot inicia em "disabled" (sem erro explícito).
   - Container-entrypoint cron será desabilitado se token vazio.

7. **Health Check Oficial**:
   - Rota: `GET /taximetro/api/health` (com basePath).
   - Deploy aguarda até 30 segundos por "healthy" status.
   - Se timeout → container é destruído (falha de deploy).
```

### 6.2 Regressão Risk Checklist por Domínio

```markdown
## Checklist de Regressão por Área

### ✅ Attendance (check-in/validate/checkout)
- [ ] Geofence validation: coordinate dentro de 200m → geoValid sempre true.
- [ ] TOTP validation: código 6-digit com step 30s sempre funciona.
- [ ] Rate limiting: já logou 10 validações em 60s → retorna 429.
- [ ] SSE streaming de status funciona (real-time na validação).
- [ ] Impersonation: COORDINATOR impersonando interno funciona,audit registry.

### ✅ Authentication & Authorization
- [ ] Credentials login (email/cpf + password) funciona.
- [ ] Google OAuth callback funciona (com GOOGLE_CLIENT_*).
- [ ] JWT token expira quando esperado (NextAuth config).
- [ ] Middleware bloqueia acesso não-autenticado (redirect to /login).
- [ ] Roles são respeitados (LEADER → /leader, não /admin).
- [ ] Force password change dispara quando flag está ativo.

### ✅ Database & Migrations
- [ ] Migrations rodam em sequência (nenhuma index de migration quebrada).
- [ ] Schema constraints são respeitados (unique, foreign keys).
- [ ] Seed.ts insere bases+faculties+admin idempotentemente (no conflicts).

### ✅ Telegram Integration
- [ ] Bot initialization não trava se token inválido.
- [ ] Webhook recebe updates apenas do TELEGRAM_GROUP_ID (validation).
- [ ] Reminder cron dispara no horário correto.

### ✅ Email Service
- [ ] SMTP error é explícito se precisa reset password e SMTP não tem config.
- [ ] Reset link contém /taximetro/ prefixo (não quebra com basePath).

### ✅ basePath="/taximetro"
- [ ] All client-side fetches prepend `/taximetro/api/...`.
- [ ] Nginx routes `/taximetro/*` to upstream correctly.
- [ ] Static assets served from `/taximetro/_next/...`.
- [ ] Redirects (login, password change) use `/taximetro/...` target.
```

### 6.3 Regras Explícitas para Agentes

Adicionar seção em AGENTS.md:

```markdown
## Regras Explícitas para Agentes IA

### NÃO FAZER
1. Nunca rodar scripts de seed sem DATABASE_URL ativo (não assume localhost).
2. Nunca alterar `basePath` em next.config sem atualizar todos os fetches.
3. Nunca desabilitar autenticação "para testar mais rápido".
4. Nunca remover rate limting verificação sem entender que é memória (não persistido).
5. Nunca mudar credential requirements sem testar força password change flow.
6. Nunca remover Telegram token fallback sem garantir que NEXT sempre está válido.
7. Nunca rodar `db:seed-prod` em dev sem proteção de NODE_ENV.

### SEMPRE FAZER
1. Validar `basePath` em next.config vs todos os paths conhecidos (checklist).
2. Testar migração em banco limpo antes de rodar em produção.
3. Incluir impersonation flag em audit logs ("impersonating: <realUserId>").
4. Usar `getEffectiveUser()` para obter usuário real (não assume token).
5. Verificar que crons estão em scripts/container-entrypoint.sh (não em GHA).
6. Validar TELEGRAM_BOT_TOKEN_NEXT está preenchido ANTES de disable legacy token.
7. Documentar mudanças em docs/runtime-truth.md seção "Pontos operacionais".

### SEMPRE VALIDAR ANTES DE DEPLOY
1. Health check interno: `wget http://127.0.0.1:3000/taximetro/api/health`
2. Health check externo (via Nginx): `curl https://127.0.0.1/taximetro/login` (com -H "Host: mnrs.com.br")
3. Database migration status: logs sem erro de `drizzle-kit push`.
4. Nginx reload status: `docker exec repo-nginx-1 nginx -s reload` retorna 0.

### REGRA OURO: READ-ONLY FIRST
Antes de qualquer mudança:
- Ler este documento (ANÁLISE-ESTRUTURAL-REPOSITÓRIO.md)
- Ler docs/runtime-truth.md (seção 0 — pontos mínimos)
- Ler AGENTS.md (regras operacionais)
- Mapear impacto de regressão esperado
- Descrever validação objetiva (não "parece funcionando")
-  Só depois propor mudança
```

---

## 7. Dúvidas em Aberto

### Operacionais
1. **Rate limiting em multi-container:** Como será tratado se app escalar? Redis, ou aceitar que é só proteção básica?
2. **Database URL Fallback:** Centralizar em função única, ou deixar como está (replicado)?
3. **Impersonation Session Duration:** Há limite de tempo ou é indefinido enquanto token válido?
4. **SMTP Failover:** Se SMTP cai, há retry automático ou usuário fica bloqueado?

### Técnicas
5. **Next.js App Router Breaking Changes:** Existe teste automatipado para detectar se basePath foi alterado sem atualizar rotas?
6. **Cron Dependency:** Se cron-reminder tenta conectar a DB e DB está down, o que acontece? (LogError ou retorna 5xx?)
7. **Seed Idempotency:** Rodar `docker run ... npx tsx src/db/seed.ts` 2x no mesmo banco.
   - Primeira: insere bases/faculties/admin ✓
   - Segunda: `onConflictDoNothing()` ignora duplicatas ✓
   - Mas se admin user ID muda, roles podem ficar órfãs?

### Governança
8. **Feature Flags:** Há sistema para feature flags (dark launches), ou mudanças sempre são full rollout?
9. **Rollback Strategy:** Se deploy quebra healthcheck, GitHub Actions faz rollback automático? (Não parece ter)
10. **Secrets Rotation:** Quando trocar GOOGLE_CLIENT_SECRET ou SMTP_PASS, há processo documentado ou é manual em GitHub Secrets UI?

### Conhecimento Distribuído
11. **Arquivo instrucoes-checkin-qrcode-telegram.md:** É referência oficial ou legacy? Deve ser arquivo ou wiki?
12. **Fixme no data-flow.md:** "Preservar basePath /taximetro em links" — há test que valida isso?

---

## Conclusão

O Taxímetro Digital é sistema **production-ready com fundação sólida**, mas apresenta **zonas de fragilidade específicas** que merecem atenção antes de grandes refatorações:

- ✅ **Stack moderno e consistente** (Next.js 15, Drizzle, PostgreSQL, Docker)
- ✅ **Deploy reproducível** (GitHub Actions, migrations automáticas, health checks)
- ✅ **Segurança multifalor** (geofence + TOTP + validação manual)
- ⚠️ **Rate limiting em memória** (não escalável, não persistido)
- ⚠️ **Rate limiting token rotation** (silencioso, sem alerta)
- ⚠️ **Documentação parcialmente desatualizada** (docs/ descreve alvo, não realidade)
- ⚠️ **Impersonation sem revogação** (feature audada, mas sem session limit)

**Recomendação Imediata:** Usar [docs/runtime-truth.md](docs/runtime-truth.md) seção 0 como checklist obrigatório antes de qualquer mudança. Atualizar AGENTS.md com regras explícitas desta análise.

**Risco Geral para Agentes:** Baixo-a-moderado se seguidas as regras operacionais. Alto risco apenas em mudanças a basePath, autenticação ou migrations.
