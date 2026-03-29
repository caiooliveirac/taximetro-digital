# Taxímetro Digital — SAMU Salvador

> **Controle de presença anti-fraude para internos de medicina no SAMU 192 Salvador.**

Sistema completo de gestão de frequência, escala e ocorrências clínicas com validação em tempo real via geolocalização, TOTP e Telegram. Projetado para operar em bases descentralizadas do SAMU, com múltiplos níveis de acesso e auditoria ponta-a-ponta.

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Stack Tecnológico](#stack-tecnológico)
4. [Sistema Anti-Fraude](#sistema-anti-fraude)
5. [Fluxo de Presença](#fluxo-de-presença)
6. [Papéis e Permissões](#papéis-e-permissões)
7. [Rotas e Funcionalidades](#rotas-e-funcionalidades)
8. [Segurança](#segurança)
9. [Deploy](#deploy)
10. [Desenvolvimento Local](#desenvolvimento-local)
11. [Variáveis de Ambiente](#variáveis-de-ambiente)
12. [Banco de Dados](#banco-de-dados)
13. [Decisões de Projeto](#decisões-de-projeto)

---

## Visão Geral

O Taxímetro Digital resolve um problema real: **como garantir que o interno de medicina está fisicamente presente na base do SAMU durante o plantão?**

### O problema

- Bases distribuídas por toda Salvador (USA, Central)
- Preceptores nem sempre presentes no início do plantão
- Impossível validar presença à distância sem risco de fraude
- Escalas gerenciadas em planilhas sem controle de auditoria

### A solução

Um sistema web progressivo (PWA) que combina **geofencing GPS**, **TOTP rotativo de 30 segundos** e **validação por preceptor** (via app ou Telegram) para criar uma prova de presença multifator.

---

## Arquitetura

```
┌─────────────┐      ┌──────────────────────────────────────┐
│   Interno   │──────│  Next.js 15 (App Router)             │
│   (PWA)     │ GPS  │                                      │
├─────────────┤      │  ┌──────────┐  ┌──────────────────┐  │
│  Preceptor  │──────│  │ NextAuth │  │ Drizzle ORM      │  │──── PostgreSQL 16
│   (App)     │      │  │  (JWT)   │  │ (14 tabelas)     │  │
├─────────────┤      │  └──────────┘  └──────────────────┘  │
│  Telegram   │──────│                                      │
│   Bot       │ API  │  ┌──────────┐  ┌──────────────────┐  │
├─────────────┤      │  │  TOTP    │  │ SSE (real-time)  │  │
│   Líder     │──────│  │ (otplib) │  │ Validação live   │  │
│   (App)     │      │  └──────────┘  └──────────────────┘  │
├─────────────┤      │                                      │
│ Coordenador │──────│  Middleware RBAC + Audit Log          │
│   (Admin)   │      └──────────────────────────────────────┘
└─────────────┘
```

### Fluxo de dados

1. **Check-in**: Interno envia coordenadas GPS → validação de geofence (Haversine) → gera sessão TOTP
2. **Código TOTP**: Código de 6 dígitos rotaciona a cada 30s → exibido como QR + texto
3. **Validação**: Preceptor escaneia QR ou digita código via App/Telegram → valida presença
4. **Notificação**: SSE envia confirmação em tempo real para o interno

---

## Stack Tecnológico

| Camada    | Tecnologia                     | Versão |
| --------- | ------------------------------ | ------ |
| Framework | Next.js (App Router, RSC)      | 15.5   |
| Runtime   | React                          | 19.2   |
| Auth      | NextAuth.js (JWT, Credentials) | 5.0β   |
| ORM       | Drizzle ORM                    | 0.45   |
| Banco     | PostgreSQL                     | 16     |
| Validação | Zod                            | 4.3    |
| Bot       | grammY (Telegram Bot API)      | 1.41   |
| TOTP      | otplib (RFC 6238)              | 13.3   |
| QR Code   | qrcode                         | 1.5    |
| CSS       | Tailwind CSS                   | 4.2    |
| UI        | Radix UI + shadcn/ui           | —      |
| Ícones    | Lucide React                   | 0.577  |
| Tipagem   | TypeScript (strict)            | 5.9    |
| Build     | Docker (multi-stage, Alpine)   | —      |

---

## Sistema Anti-Fraude

O Taxímetro emprega **5 camadas independentes** de proteção contra fraude:

### 1. Geofencing por Haversine

Cada base SAMU tem coordenadas GPS calibradas e um raio configurável (padrão: 200m). No check-in, calculamos a distância entre as coordenadas do interno e da base usando a fórmula de Haversine.

```
distância = 2R × arcsin(√(sin²(Δlat/2) + cos(lat₁) × cos(lat₂) × sin²(Δlng/2)))
```

- **Raio configurável** por base (coordenador pode ajustar via "Calibrar")
- **Distância registrada** em metros no banco para auditoria
- **Flag `geoValid`** armazenada — mesmo que a distância exceda o raio, o check-in é registrado com `geoValid: false` para análise posterior

### 2. TOTP Rotativo (30 segundos)

Após o check-in geográfico, o sistema gera um segredo TOTP único (RFC 6238) para aquela sessão. Um código de 6 dígitos é derivado e rotaciona a cada **30 segundos**.

- **Janela efetiva**: 30s ± 1 período de tolerância = 90s máximo
- **Segredo único** por sessão de check-in (nunca reutilizado)
- **Exibição dupla**: QR Code (para scan pelo Telegram) + código numérico (para digitação)
- **Countdown visual**: barra de progresso com indicador colorido (verde → âmbar ≤10s → vermelho pulsante ≤5s)

### 3. Validação por Preceptor

O código TOTP só pode ser validado por um **preceptor autorizado** e **vinculado à mesma base** do interno.

- **Via App**: Preceptor acessa `/preceptor` e digita o código
- **Via Telegram**: Preceptor envia código ao bot após vincular conta com `/start`
- **Verificação de base**: Sistema confirma que `preceptor.baseId === interno.baseId`
- **Auditoria**: Tentativa de validar interno de outra base gera log `VALIDATE_WRONG_BASE`

### 4. Validação de Turno

O check-in é bloqueado fora do horário do plantão atribuído:

| Turno | Horário Permitido | Bloqueado     |
| ----- | ----------------- | ------------- |
| DIA   | 04:00 – 20:00     | 20:00 – 04:00 |
| NOITE | 17:00 – 08:00     | 08:00 – 17:00 |

Janela de sobreposição (17:00–20:00 e 04:00–08:00) permite transição entre turnos.

### 5. Rate Limiting

Endpoint de validação protegido contra força bruta:

- **10 tentativas por minuto** por validador (userId)
- **Janela deslizante** com limpeza automática de entradas expiradas
- **Log de auditoria** quando rate limit é atingido (`VALIDATE_RATE_LIMITED`)
- **Tentativas falhas** registradas como `VALIDATE_FAILED`

---

## Fluxo de Presença

```
Interno                    Sistema                     Preceptor
  │                          │                            │
  │── Acessar /checkin ─────▶│                            │
  │                          │── Verificar plantão ativo  │
  │                          │── Verificar horário turno  │
  │◀── Mostrar tela checkin ─│                            │
  │                          │                            │
  │── Enviar GPS ───────────▶│                            │
  │                          │── Calcular Haversine       │
  │                          │── Gerar TOTP secret        │
  │                          │── Iniciar SSE stream       │
  │◀── Exibir QR + código ──│                            │
  │    (countdown 30s)       │                            │
  │                          │                            │
  │                          │       Escanear QR / digitar│
  │                          │◀──────── código ───────────│
  │                          │── Verificar rate limit     │
  │                          │── Verificar base preceptor │
  │                          │── Verificar TOTP           │
  │                          │── Registrar validação      │
  │                          │── Log auditoria            │
  │◀── SSE: "VALIDATED" ────│──── Resposta: sucesso ────▶│
  │                          │                            │
  │── (fim do plantão) ─────▶│                            │
  │── Checkout + notas ─────▶│                            │
  │                          │── Registrar checkout       │
  │◀── Confirmação ─────────│                            │
```

---

## Papéis e Permissões

| Funcionalidade         | Coordenador | Líder | Preceptor | Interno |
| ---------------------- | :---------: | :---: | :-------: | :-----: |
| Dashboard admin        |     ✅      |       |           |         |
| Gerenciar usuários     |     ✅      |       |           |         |
| Gerenciar bases        |     ✅      |       |           |         |
| Calibrar coordenadas   |     ✅      |  ✅   |           |         |
| Gerenciar faculdades   |     ✅      |       |           |         |
| Regras de vagas        |     ✅      |       |           |         |
| Ver auditoria          |     ✅      |       |           |         |
| Gerar convites         |     ✅      |  ✅   |           |         |
| Gerenciar escala       |     ✅      |  ✅   |           |         |
| Aprovar solicitações   |     ✅      |  ✅   |           |         |
| Relatórios             |     ✅      |  ✅   |           |         |
| Validar presença (App) |             |       |    ✅     |         |
| Validar presença (Bot) |             |       |    ✅     |         |
| Check-in com GPS       |             |       |           |   ✅    |
| Solicitar troca/extra  |             |       |           |   ✅    |
| Registrar ocorrências  |             |       |           |   ✅    |
| Ver histórico próprio  |             |       |           |   ✅    |

### Middleware RBAC

Rotas protegidas por prefixo no middleware:

- `/admin/*` → somente `COORDINATOR`
- `/leader/*` → somente `LEADER`
- `/preceptor/*` → somente `PRECEPTOR`
- `/intern/*` → somente `INTERN`
- API routes validam `token.role` internamente

---

## Rotas e Funcionalidades

### 47 Rotas (21 páginas + 26 endpoints API)

<details>
<summary><strong>Páginas (21)</strong></summary>

| Rota                   | Descrição                                 |
| ---------------------- | ----------------------------------------- |
| `/login`               | Login via CPF + senha                     |
| `/registro`            | Auto-cadastro de interno via link-convite |
| `/admin`               | Dashboard coordenador (métricas, alertas) |
| `/admin/usuarios`      | CRUD de usuários (todos os papéis)        |
| `/admin/bases`         | Gerenciamento de bases SAMU               |
| `/admin/faculdades`    | Gerenciamento de faculdades               |
| `/admin/escalas`       | Visualização/criação de escala            |
| `/admin/presencas`     | Registros de presença                     |
| `/admin/solicitacoes`  | Aprovação de solicitações                 |
| `/admin/audit`         | Log de auditoria do sistema               |
| `/leader`              | Dashboard líder (métricas da faculdade)   |
| `/leader/internos`     | Lista de internos da faculdade            |
| `/leader/escala`       | Escala da faculdade                       |
| `/leader/vagas`        | Vagas disponíveis                         |
| `/leader/calibrar`     | Calibrar bases (coordenadas GPS)          |
| `/leader/solicitacoes` | Solicitações de troca/extra               |
| `/leader/relatorios`   | Relatórios de presença                    |
| `/preceptor`           | Tela de validação de presença             |
| `/intern`              | Dashboard do interno (plantão de hoje)    |
| `/intern/checkin`      | Check-in com GPS + TOTP                   |
| `/intern/historico`    | Histórico de presenças                    |
| `/intern/trocas`       | Solicitações de troca/extra/desistência   |
| `/intern/ocorrencias`  | Registro de ocorrências clínicas          |

</details>

<details>
<summary><strong>API Endpoints (26)</strong></summary>

| Método     | Rota                             | Descrição                         |
| ---------- | -------------------------------- | --------------------------------- |
| `*`        | `/api/auth/[...nextauth]`        | NextAuth (login, logout, session) |
| `GET`      | `/api/admin/users`               | Listar usuários                   |
| `POST`     | `/api/admin/users`               | Criar usuário                     |
| `PUT`      | `/api/admin/users/:id`           | Atualizar usuário                 |
| `GET`      | `/api/admin/bases`               | Listar bases                      |
| `POST`     | `/api/admin/bases`               | Criar base                        |
| `POST`     | `/api/admin/bases/:id/calibrate` | Calibrar coordenadas              |
| `GET`      | `/api/admin/faculties`           | Listar faculdades                 |
| `POST`     | `/api/admin/faculties`           | Criar faculdade                   |
| `GET`      | `/api/admin/rules`               | Listar regras de vagas            |
| `POST`     | `/api/admin/rules`               | Criar regra de vaga               |
| `GET`      | `/api/admin/audit`               | Log de auditoria                  |
| `GET`      | `/api/admin/alerts`              | Alertas do sistema                |
| `POST`     | `/api/attendance/checkin`        | Check-in com geolocalização       |
| `POST`     | `/api/attendance/checkout`       | Check-out com notas               |
| `POST`     | `/api/attendance/validate`       | Validar presença (código/direto)  |
| `GET`      | `/api/attendance/totp-refresh`   | Refresh TOTP ativo                |
| `GET`      | `/api/attendance/status`         | Status SSE (Server-Sent Events)   |
| `GET`      | `/api/assignments`               | Listar atribuições                |
| `POST`     | `/api/assignments`               | Criar atribuição                  |
| `GET`      | `/api/slots/available`           | Vagas disponíveis                 |
| `GET/POST` | `/api/requests`                  | Solicitações de troca             |
| `POST`     | `/api/case-records`              | Registrar ocorrência              |
| `GET`      | `/api/leader/convites`           | Convites pendentes                |
| `GET`      | `/api/leader/pendentes`          | Solicitações pendentes            |
| `POST`     | `/api/registro/:token`           | Auto-cadastro via convite         |
| `POST`     | `/api/telegram/webhook`          | Webhook do bot Telegram           |
| `GET`      | `/api/health`                    | Health check + latência DB        |

</details>

---

## Segurança

### Headers HTTP

Configurados globalmente via `next.config.ts`:

| Header                      | Valor                                 | Proteção              |
| --------------------------- | ------------------------------------- | --------------------- |
| `X-Frame-Options`           | `DENY`                                | Clickjacking          |
| `X-Content-Type-Options`    | `nosniff`                             | MIME-type sniffing    |
| `Referrer-Policy`           | `origin-when-cross-origin`            | Vazamento de contexto |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Downgrade HTTPS→HTTP  |
| `Permissions-Policy`        | `geolocation=(self)`                  | Acesso a sensores     |

### Autenticação

- **NextAuth v5** com estratégia JWT (sem sessão no banco)
- **Credenciais**: CPF (11 dígitos) + senha
- **Hashing**: bcryptjs com salt automático
- **Token JWT** contém: `id`, `role`, `facultyId`, `baseId`, `name`
- **Middleware** valida token em todas as rotas protegidas

### Convites com Expiração

- Links de convite para auto-cadastro de internos
- **TTL de 7 dias** — token expira automaticamente
- Token aleatório de 32 caracteres (via `crypto.randomUUID`)
- Desativável manualmente pelo coordenador/líder

### Auditoria

Tabela `auditLog` registra todas as ações sensíveis:

- Check-in, validação, checkout
- Criação/atualização de usuários
- Tentativas de validação falhadas
- Rate limit atingido
- Validação de base incorreta
- Cada entrada inclui: `userId`, `action`, `entity`, `entityId`, `payload` (JSONB), `ipAddress`, `timestamp`

---

## Deploy

### Dockerfile (multi-stage)

```dockerfile
FROM node:20-alpine AS deps     # Instalar dependências
FROM node:20-alpine AS builder  # Build Next.js + Drizzle
FROM node:20-alpine AS runner   # Imagem final de produção
```

Imagem final contém apenas o `standalone` output + assets estáticos + migrações Drizzle.

### Requisitos de Infraestrutura

- **Node.js 20** (Alpine)
- **PostgreSQL 16**
- **NGINX** como reverse proxy (recomendado)
- **SSL/TLS** obrigatório (HSTS configurado)
- **Volume persistente** para `/var/backups/taximetro` se o backup diário estiver habilitado

### Backup diário do banco

O container de produção agenda um dump diário do PostgreSQL via `pg_dump` em formato custom (`.dump`) e pode encaminhar esse arquivo por e-mail.

- Horário padrão: `37 3 * * *`
- Timezone padrão: `America/Bahia`
- Diretório padrão: `/var/backups/taximetro`
- Retenção padrão: `14` dias
- Envio por e-mail: habilita ao definir `DB_BACKUP_EMAIL_TO`

Execução manual:

```bash
npm run db:backup
```

Restauração manual:

```bash
sh scripts/restore-db-backup.sh /caminho/do/arquivo.dump
```

No deploy com Docker, monte um volume do host para o diretório de backup. Sem isso, o dump fica preso ao filesystem do container e se perde ao recriar a instância.

### PWA

Aplicação instalável como Progressive Web App:

- `manifest.json` com tema SAMU (#1E3A5F)
- Ícones em `public/icons/`
- `display: standalone` para experiência nativa
- `scope: /taximetro/` com basePath configurado

### Health Check

```
GET /api/health
```

Retorna status da aplicação e latência do banco:

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z",
  "uptime": 86400,
  "db": {
    "connected": true,
    "latencyMs": 3
  }
}
```

Retorna HTTP `503` se o banco estiver inacessível. Ideal para load balancers e monitoramento.

---

## Desenvolvimento Local

### Pré-requisitos

- Node.js 20+
- PostgreSQL 16 rodando localmente
- Banco `taximetro` criado

### Setup

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env.local
# Editar DATABASE_URL, AUTH_SECRET, TELEGRAM_BOT_TOKEN e SMTP_*

# Rodar migrações
npx drizzle-kit push

# Seed de dados (opcional)
npx tsx src/db/seed.ts

# Iniciar desenvolvimento
npm run dev
```

### Scripts Disponíveis

| Comando               | Descrição                        |
| --------------------- | -------------------------------- |
| `npm run dev`         | Servidor de desenvolvimento      |
| `npm run build`       | Build de produção                |
| `npm run start`       | Iniciar produção                 |
| `npm run lint`        | Linting                          |
| `npm run db:backup`   | Executar dump manual do banco    |
| `npm run db:generate` | Gerar migrações Drizzle          |
| `npm run db:migrate`  | Aplicar migrações                |
| `npm run db:push`     | Push schema (dev)                |
| `npm run db:studio`   | Interface visual do banco        |
| `npm run db:seed`     | Popular banco com dados de teste |

---

## Variáveis de Ambiente

| Variável             | Descrição                    | Exemplo                                           |
| -------------------- | ---------------------------- | ------------------------------------------------- |
| `DATABASE_URL`       | Connection string PostgreSQL | `postgresql://user:pass@localhost:5432/taximetro` |
| `AUTH_SECRET`        | Segredo JWT do NextAuth      | `openssl rand -base64 32`                         |
| `AUTH_URL`           | URL pública sem barra final  | `https://mnrs.com.br`                             |
| `TELEGRAM_BOT_TOKEN` | Token do bot Telegram        | `123456:ABC-DEF...`                               |
| `SMTP_HOST`          | Host SMTP                    | `smtp.gmail.com`                                  |
| `SMTP_PORT`          | Porta SMTP                   | `587`                                             |
| `SMTP_USER`          | Usuário SMTP                 | `noreply@mnrs.com.br`                             |
| `SMTP_PASS`          | Senha/app password SMTP      | `senha-ou-app-password`                           |
| `SMTP_FROM`          | Remetente exibido            | `Taxímetro Digital <noreply@mnrs.com.br>`         |
| `SMTP_SECURE`        | Usa SMTPS direto             | `false`                                           |
| `DB_BACKUP_ENABLED`  | Liga o cron de backup        | `true`                                            |
| `DB_BACKUP_CRON`     | Expressão cron diária        | `37 3 * * *`                                      |
| `DB_BACKUP_TZ`       | Timezone do cron             | `America/Bahia`                                   |
| `DB_BACKUP_DIR`      | Pasta persistente do dump    | `/var/backups/taximetro`                          |
| `DB_BACKUP_PREFIX`   | Prefixo do arquivo           | `taximetro`                                       |
| `DB_BACKUP_RETENTION_DAYS` | Quantos dias manter    | `14`                                              |
| `DB_BACKUP_EMAIL_TO` | Destinatários do dump        | `coord@example.com,ti@example.com`                |
| `TELEGRAM_CHECKIN_REMINDER_ENABLED` | Liga os alertas de 8h/9h | `true`                                  |
| `TELEGRAM_CHECKIN_REMINDER_CRON` | Expressão cron dos alertas | `0 8,9 * * *`                           |

### Gmail: configuração prática

Se a intenção for usar uma conta Google/Gmail só para os envios de redefinição de senha, o conjunto mais útil é este:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_TLS_REJECT_UNAUTHORIZED=true
SMTP_USER=seu.email@gmail.com
SMTP_PASS=sua_app_password_do_google
SMTP_FROM=Taxímetro Digital <seu.email@gmail.com>
```

Regras práticas:

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` e `SMTP_PASS` são os únicos realmente obrigatórios para o envio funcionar.
- `SMTP_SECURE=false` com porta `587` é o padrão mais comum do Gmail.
- `SMTP_FROM` não é tecnicamente obrigatório no código, mas é altamente recomendado. No Gmail, o ideal é usar o mesmo endereço de `SMTP_USER`.
- `SMTP_REQUIRE_TLS=true` ajuda a forçar conexão segura sem precisar usar a porta 465.
- `SMTP_PASS` no Gmail não deve ser a senha normal da conta. Deve ser uma `App Password` criada após ativar verificação em 2 etapas.
- `AUTH_URL` continua importante porque ele define a base do link enviado no e-mail de redefinição.

Para o fluxo de redefinição de senha funcionar em produção, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` e `SMTP_PASS` precisam estar presentes no ambiente do container. Sem isso, a rota de `esqueci senha` passa a responder com erro explícito e registrar auditoria de falha de entrega.

Para o envio do backup diário por e-mail funcionar, reaproveitamos o mesmo SMTP. Basta definir `DB_BACKUP_EMAIL_TO` com um ou mais destinatários separados por vírgula. O dump segue anexado em formato `.dump`; se o seu provedor tiver limite baixo de anexo, o arquivo pode exceder esse teto conforme o banco crescer.

---

## Banco de Dados

### 14 Tabelas

```
faculties          ← Faculdades de medicina
users              ← Todos os usuários do sistema
userRoles          ← Papéis (N:N com faculdade/base)
bases              ← Bases SAMU (coordenadas GPS)
slotRules          ← Regras de capacidade por turno
assignments        ← Atribuições de plantão
checkins           ← Registros de presença
requests           ← Solicitações (troca/extra/desistência)
caseRecords        ← Ocorrências clínicas
qrSessions         ← Sessões TOTP com expiração
telegramBindings   ← Vínculo Telegram ↔ usuário
auditLog           ← Trilha de auditoria completa
inviteLinks        ← Convites de auto-cadastro
```

### Índices Otimizados

- `assignments`: índices em `date`, `internId`, unique `(internId, date, period)`
- `auditLog`: índices em `createdAt`, `userId`
- `slotRules`: unique `(baseId, dayOfWeek, period, facultyId)`
- `telegramBindings`: unique em `telegramUserId` e `userId`

---

## Decisões de Projeto

### Por que TOTP e não apenas QR estático?

QR estático pode ser compartilhado via foto. TOTP rotaciona a cada 30 segundos, tornando screenshots inúteis após a janela de validade.

### Por que Haversine e não API de geolocalização externa?

- **Zero dependência externa** — funciona offline (do lado do servidor)
- **Sem custo** — Google Maps API cobra por request
- **Precisão suficiente** — erro < 0.5% para distâncias < 1km

### Por que SSE e não WebSocket?

- **Mais simples** de implementar e manter
- **Funciona com HTTP/2** sem configuração especial
- **Unidirecional** é suficiente (servidor → cliente para notificação de validação)
- **Reconexão automática** com backoff exponencial (1s → 30s)

### Por que JWT e não sessão no banco?

- **Sem estado no servidor** — escala horizontalmente sem sessão compartilhada
- **Payload inclui role** — middleware não precisa consultar banco a cada request
- **NextAuth v5** gerencia rotação e expiração automaticamente

### Por que validação de turno com overlap?

Plantões DIA (07:00–19:00) e NOITE (19:00–07:00) têm janela de sobreposição no check-in (04:00–20:00 para DIA, 17:00–08:00 para NOITE) para acomodar chegada antecipada e passagem de plantão.

### Por que rate limiting in-memory?

- **Simplicidade** — sem dependência de Redis para MVP
- **Suficiente** para cenário single-instance
- **Cleanup automático** — entradas expiradas removidas a cada verificação
- Para escalar: migrar para Redis com `@upstash/ratelimit`

---

## Licença

Projeto interno — SAMU 192 Salvador / Coordenação de Ensino.
