# Sumário: Atualização de AGENTS.md

**Data:** 10 de abril de 2026  
**Baseado em:** ANÁLISE-ESTRUTURAL-REPOSITÓRIO.md  
**Objetivo:** Incorporar análise prática de riscos reais vs teóricos, mitigações existentes e top 5 prioridades

---

## 1. Estrutura Agora em AGENTS.md

### Seção 3: Análise de Riscos Reais vs Teóricos
**O que adicionou:**
- ✅ 5 riscos REAIS com tabela: Problema | Mitigação Existente | Mitigação Faltante | Bug Imediato
- ✅ 3 riscos TEÓRICOS (baixa probabilidade)
- ✅ Cada risco mapeado com SIM/NÃO se pode quebrar produção hoje

**Riscos REAIS documentados:**
1. basePath="/taximetro" acoplado (silent 404)
2. Telegram token rotation silenciosa (bot disabled sem aviso)
3. DATABASE_URL fallback replicado (confusão em dev)
4. Crons condicionais (podem não rodar ou rodar quando desligados)
5. Seed scripts sem NODE_ENV (demo users vazam para produção)

### Seção 5: Top 5 Riscos Praticamente Críticos
**O que adicionou:**
- 🔴 #1: basePath Routing (CRÍTICA + SILENCIOSA)
  - Probabilidade: ALTA
  - Impacto: 100% do app quebrado
  - Ação: Teste de validação em CI
  
- 🔴 #2: Telegram Token Rotation (CRÍTICA + SILENCIOSA)
  - Probabilidade: ALTA
  - Impacto: 16 horas sem avisos
  - Ação: Log explícito em src/lib/telegram.ts:4
  
- 🟡 #3: DATABASE_URL Fallback (MODERADA + CONFUSÃO)
  - Probabilidade: MÉDIA
  - Impacto: Script falha ou banco errado
  - Ação: Centralizar com validação explícita
  
- 🟡 #4: Cron Config (MODERADA + INCERTEZA)
  - Probabilidade: MÉDIA
  - Impacto: Cron roda quando deveria estar desligado
  - Ação: Mover lógica para app config
  
- 🟡 #5: Seed Data Leakage (MODERADA + CONFIANÇA)
  - Probabilidade: BAIXA-MÉDIA
  - Impacto: Database contaminada
  - Ação: Adicionar NODE_ENV check em seed-prod.ts

### Seção 10: Referências Obrigatórias (NOVO)
**O que adicionou:**
- Ordem explícita de leitura para agentes
- Hierarquia de verdade: runtime-truth.md > ANÁLISE > AGENTS.md
- Aviso que docs/architecture.md e data-flow.md podem estar desatualizados

---

## 2. Dados Práticos por Risco

### O que JÁ TEM MITIGAÇÃO (código já protege):
```
✅ Telegram token fallback: src/lib/telegram.ts linha 4-5 já faz NEXT > legacy
✅ Migrations sequenciais: deploy.yml linha 50-57 drizzle-kit push --force
✅ Seed idempotence: seed.ts usa onConflictDoNothing()
✅ Audit logging: shared/infra/logger/audit.ts registra todas ações críticas
✅ Rate limiting básico: src/app/api/attendance/validate/route.ts:18-23 (10 tentativas/60s)
```

### O que NÃO TEM MITIGAÇÃO (risco aberto):
```
❌ basePath consistency: Nenhum teste valida que basePath em next.config vs rotas
❌ Token alert: Nenhum log quando NEXT token vazio e fallback para legacy
❌ DATABASE_URL validation: Replicado em 5 scripts, sem check de produção
❌ Cron runtime config: Lógica em container-entrypoint.sh, não em app
❌ Seed NODE_ENV check: Nada impede rodar db:seed-prod em dev
```

### O que PODE QUEBRAR IMEDIATAMENTE:
```
🔴 SIM — basePath mismatch: tela branca sem aviso
🔴 SIM — Telegram token vazio + legacy revoked: 16 horas sem avisos
🟡 MODERADO — DATABASE_URL mal setado: script falha explicitamente
🟡 MODERADO — Cron config perdida: backup roda quando deveria estar desligado
🟡 MODERADO — Seed-prod rodado em dev: demo users em produção
```

---

## 3. Ordem Prática de Ataque (TOP 5)

Baseado em **Probabilidade × Impacto × Visibilidade**:

1. **basePath Routing** (ALTA prob × 100% impact × INVISÍVEL debug)
   - Fácil disparar: alguém muda next.config.ts
   - Impacto devastador: app completamente quebrado
   - Debug invisível: health passa, visual falha (descobre só em produção)
   - **Recomendação:** Adicionar teste de CI

2. **Telegram Token Rotation** (ALTA prob × 16h impact × SILENCIOSO)
   - Fácil disparar: user esquece de validar token em GitHub Secrets
   - Impacto alto: internos sem avisos críticos
   - Debug silencioso: nenhum alerta que cron foi desabilitado
   - **Recomendação:** Log explícito em src/lib/telegram.ts

3. **DATABASE_URL Fallback** (MÉDIA prob × confusão × MODERADO debug)
   - Fácil disparar: dev roda script local sem env
   - Impacto: operação falha, dev confuso
   - Debug: logs mostram host mas sem contexto
   - **Recomendação:** Centralizar com validação

4. **Cron Configuration** (MÉDIA prob × cron failure × DIFÍCIL debug)
   - Fácil disparar: user tenta disable via docker update
   - Impacto: cronroda/não roda inesperadamente
   - Debug: difícil (entrypoint roda 1x, crond silencioso)
   - **Recomendação:** Config centralizado em app

5. **Seed Data Leakage** (BAIXA-MÉDIA prob × contamination × VISÍVEL depois)
   - Fácil disparar: dev roda seed-prod local + commits
   - Impacto: 100+ fake users em produção
   - Debug: visível após, pode passar em review
   - **Recomendação:** NODE_ENV check em seed-prod.ts

---

## 4. Como Este Documento Se Relaciona

```
ANÁLISE-ESTRUTURAL-REPOSITÓRIO.md
  ↓
  Define problemas estruturais (12 fragilidades)
  Define mitigações existentes vs faltantes
  Define criticidade por domínio
  ↓
AGENTS.md (ATUALIZADO)
  ↓
  Resume 5 riscos REAIS vs teóricos
  Prioriza top 5 por ordem de ataque
  Dá ações concretas (testes, logs, validação)
  ↓
docs/runtime-truth.md (SEÇÃO 0)
  ↓
  Operacionais mínimos (basePath, endpoints, deploy, health, migrations)
  Checklist objetiva antes de mudança
  ↓
Desenvolvimento futuro
  ↓
  Implementar mitigações faltantes
  Referenciar AGENTS.md como guardrail
```

---

## 5. Próximas Ações (Sugeridas, não implementadas)

**Para reduzir top 5 riscos:**

1. **CI Test para basePath** → Arquivo com conhecidos paths, validar contra next.config.ts
2. **Log em src/lib/telegram.ts** → console.log("[telegram] TELEGRAM_BOT_TOKEN_NEXT empty")
3. **Função centralizada DATABASE_URL** → src/db/get-connection.ts com validação
4. **Cron app config** → App lê DB_BACKUP_ENABLED at runtime, não só init
5. **NODE_ENV check seed-prod.ts** → `if (process.env.NODE_ENV !== "development") throw`

---

## Conclusão

AGENTS.md agora é **muito mais prático e específico:**
- ✅ Define claramente quais riscos são REAIS (podem quebrar hoje) vs TEÓRICOS (improváveis)
- ✅ Documenta mitigações EXISTENTES (código já protege) vs FALTANTES (risco aberto)
- ✅ Prioriza top 5 por ordem de ataque prático (probabilidade × impacto × visibilidade)
- ✅ Dá ações concretas (teste de CI, log, refactoring) para cada risco

**Risco geral para agentes:** Baixo-a-moderado se seguidas as regras operacionais descritas. Alto risco apenas em mudanças a basePath, token rotation ou migrations.
