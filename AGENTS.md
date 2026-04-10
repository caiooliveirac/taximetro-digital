# AGENTS.md

Este arquivo define as regras operacionais para agentes (Codex/Claude) neste repositório.
Objetivo: reduzir risco de regressão, evitar quebra de deploy/versionamento e manter o projeto pronto para uma pipeline de GitHub Actions robusta.

## 1. Verdades Oficiais do Ambiente

- Runtime oficial: Docker
- App oficial: Next.js com `basePath` `/taximetro`
- Proxy oficial: Nginx externo rodando em container na VM
- Banco oficial: PostgreSQL rodando na EC2 (acessível dentro da máquina)
- Deploy oficial: GitHub Actions

## 2. Postura Padrão de Operação

- Padrão inicial obrigatório: `read-only first`
- Sempre analisar contexto, arquivos, impactos e fluxo atual antes de sugerir ou executar mudanças
- Nunca editar código, config ou scripts sem pedido explicito do usuário
- Nunca abrir PR sem pedido explicito do usuário
- Nunca criar branch sem pedido explicito do usuário

## 3. Análise de Riscos Reais vs Teóricos

**Baseado em auditoria completa (ver ANÁLISE-ESTRUTURAL-REPOSITÓRIO.md)**

### Riscos REAIS (Podem quebrar produção HOJE)

**1. basePath="/taximetro" acoplado em 46 rotas**
- **Problema:** Se alguém muda `next.config.ts` sem atualizar fetches → silent 404 em produção
- **Mitigação existente:** ✅ Todas as rotas client incluem `/taximetro/` explicitamente
- **Mitigação faltante:** ❌ Nenhum teste valida consistency
- **Bug imediato:** SIM — mudança em next.config.ts causa tela branca

**2. Telegram token rotation SILENCIOSA**
- **Problema:** Se `TELEGRAM_BOT_TOKEN_NEXT` inválido → fallback silencioso a token revoked → bot "disabled", cron não roda
- **Mitigação existente:** ✅ Fallback prioritário em `src/lib/telegram.ts` (NEXT > legacy)
- **Mitigação faltante:** ❌ Nenhum alerta se ambos vazios
- **Bug imediato:** SIM — internos não recebem alertas 8h/9h sem saber por quê

**3. DATABASE_URL fallback replicado (5 scripts)**
- **Problema:** Fallback em 5 lugares para `postgresql://localhost:5432/taximetro` sem validação
- **Mitigação existente:** ✅ GitHub Actions injeta via secrets
- **Mitigação faltante:** ❌ Se rodado localmente sem env, modifica localhost
- **Bug imediato:** MODERADO — Dev confunde, mas script falha em produção

**4. Crons em lógica condicional de script (container-entrypoint.sh)**
- **Problema:** Se env var apagada em docker update → cron pré-existing continua rodando
- **Mitigação existente:** ✅ Defaults (true) garantem crons normalmente
- **Mitigação faltante:** ❌ Sem config centralizada para disable dinâmico
- **Bug imediato:** MODERADO — Cron roda quando deveria estar desligado

**5. Seed scripts sem NODE_ENV proteção**
- **Problema:** `npm run db:seed-prod` pode rodar em dev, demo users vazam para produção
- **Mitigação existente:** ✅ `seed.ts` usa `onConflictDoNothing()` (idempotent)
- **Mitigação faltante:** ❌ Nada impede rodar db:seed-prod em dev
- **Bug imediato:** MODERADO — Requer dev local + commit errado, mas possível

### Riscos TEÓRICOS (Improváveis em single-container)

- **Rate limiting em memória**: Aplicável se escalar para multi-container (hoje: baixíssimo risco)
- **Impersonation sem revogação**: Auditada, team confiável (melhoria futura, não crítica)
- **Docs desatualizadas**: Confundem mas não quebram runtime (use docs/runtime-truth.md como oficial)

---

## 4. Regras de Segurança de Mudança

Antes de qualquer proposta de correção, o agente deve mapear risco de regressão:

1. Quais rotas/fluxos serão afetados
2. Quais variáveis de ambiente podem impactar comportamento
3. Quais dependências de runtime (Docker, Nginx, DB, cron, bot) entram no impacto
4. Quais testes/checagens devem ser executados para validar que nao houve quebra

Toda sugestão de mudança deve vir com:
- impacto esperado
- risco de regressão (baixo/medio/alto)
- plano de validação objetivo
- plano de rollback simples

---

## 5. Top 5 Riscos Praticamente Críticos (Ordem de Ataque)

Baseado em: Probabilidade (quão fácil disparar?) × Impacto (quanto quebra?) × Visibilidade (quão óbvio é o erro?)

### 🔴 #1: basePath Routing Mismatch — CRÍTICA + SILENCIOSA
**Cenário:** Alguém muda `next.config.ts` de `basePath: "/taximetro"` para `basePath: "/app"`

**O que acontece:**
- Build passa ✅ | Deploy succeeds ✅ | Health check (`/taximetro/api/health`) retorna OK ✅
- Mas todas as requisições client para `/app/api/...` retornam 404 ❌
- App fica com tela branca em produção ❌

**Probabilidade:** ALTA | **Impacto:** 100% do app quebrado | **Debug:** Invisível até produção

**Ação:** Adicionar validação em CI que compara `next.config.ts` basePath vs paths conhecidos em codebase

---

### 🔴 #2: Telegram Token Rotation Silent Failure — CRÍTICA + SILENCIOSA
**Cenário:** User atualiza `TELEGRAM_BOT_TOKEN_NEXT` com valor vazio ou inválido

**O que acontece:**
- Container inicia normalmente ✅
- Bot fallback silenciosamente a `TELEGRAM_BOT_TOKEN` (revoked) ⚠️
- Cron `0 8,9 * * *` é desabilitado silenciosamente (container-entrypoint condicional) ❌
- Internos não recebem alertas 8h/9h ❌
- Zero logs sobre por quê ❌

**Probabilidade:** ALTA | **Impacto:** 0 avisos de check-in, 16 horas sem alertas | **Debug:** Requer conhecer behavior

**Ação:** Adicionar log explícito em `src/lib/telegram.ts` line 4: `console.log("[telegram] TELEGRAM_BOT_TOKEN_NEXT empty, using legacy token")`

---

### 🟡 #3: DATABASE_URL Fallback Confusion — MODERADA + CONFUSÃO
**Cenário:** Dev roda `npx tsx src/db/seed.ts` sem `DATABASE_URL` setado

**O que acontece:**
- Script silenciosamente conecta a `postgresql://localhost:5432/taximetro` ✅
- Se localhost não existe → operation falha ❌ (dev confuso por quê)
- Localizado em 5 arquivos: `drizzle.config.ts`, `seed.ts`, `seed-dev.ts`, `seed-prod.ts`, `fix-coords.ts`

**Probabilidade:** MÉDIA | **Impacto:** Script fails, dev confusa | **Debug:** MODERADO (logs mostram host)

**Ação:** Centralizar em função única com validação: `throw new Error("DATABASE_URL not set")` se não possui env

---

### 🟡 #4: Cron Configuration Uncertainty — MODERADA + INCERTEZA  
**Cenário:** User tenta desabilitar backup via `docker update -e DB_BACKUP_ENABLED=false`

**O que acontece:**
- Env var atualizado ✅
- Mas `container-entrypoint.sh` já rodou (durante init) ❌
- Backup cron pré-existing continua na crontab ❌
- Backup roda à noite mesmo que flag diz "disabled" ❌

**Probabilidade:** MÉDIA | **Impacto:** Cron roda quando não deveria | **Debug:** DIFÍCIL (entrypoint roda 1x, crond roda silenciosamente)

**Ação:** Mover lógica de crons para app config (ou documentar que disable requer container restart)

---

### 🟡 #5: Seed Data Leakage — MODERADA + CONFIANÇA
**Cenário:** Dev roda `npm run db:seed-prod` localmente (acidental), commit com demo users, deploy via GHA

**O que acontece:**
- 100+ fake/demo users em produção database ❌
- Admin user "Caio Oliveira" com password "admin123" em system ❌
- Real users veem dados fake ❌

**Probabilidade:** BAIXA-MÉDIA | **Impacto:** Database contaminada, GDPR concerns | **Debug:** Visível em DB, pode passar em review

**Ação:** Adicionar `if (process.env.NODE_ENV !== "development") throw new Error(...)` em `seed-prod.ts`

---

## 6. Regras de Deploy

- Não declarar sucesso de deploy sem validação objetiva
- Validar sempre:
  - container em `Up`
  - health interno da app
  - rota externa via Nginx (`/taximetro/...`)
- Em recriação de container, considerar recarga do Nginx quando necessário

## 7. Regras de Configuração e Versionamento

- Não versionar segredos reais
- Usar `.env.example` como fonte versionável de referência
- Manter compatibilidade com `basePath` `/taximetro` em links, callbacks e rotas
- Evitar mudanças que acoplem deploy a estado local manual quando houver fluxo oficial por GitHub Actions

## 8. Regra de Comunicação Técnica

Ao responder, o agente deve:
- separar claramente: diagnóstico, risco, ação, validação
- priorizar evidência observável (status, health, endpoint)
- não expor secrets em logs ou respostas

## 9. Fluxo Mínimo Antes de Agir

1. Ler contexto atual
2. Confirmar componente oficial impactado (Docker/Next/Nginx/Postgres/GHA)
3. Avaliar risco de regressão
4. Propor ação mínima e reversível
5. Validar resultado com checks objetivos

Se qualquer etapa acima nao puder ser comprovada, o agente deve sinalizar limite e nao assumir sucesso.

---

## 10. Referências Obrigatórias

Antes de qualquer mudança, ler nesta ordem:
1. **docs/runtime-truth.md** — Seção 0 (pontos operacionais mínimos: basePath, endpoints, deploy, health, migrations)
2. **ANÁLISE-ESTRUTURAL-REPOSITÓRIO.md** — Contexto completo de arquitetura e fragilidades
3. **AGENTS.md** (este arquivo) — Regras operacionais

Estes documentos são fonte única de verdade. Docs em docs/architecture.md e docs/data-flow.md podem estar desatualizados (marcar como referência, não verdade).
