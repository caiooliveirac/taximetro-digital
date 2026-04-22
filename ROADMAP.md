# Roadmap

Direção de produto e engenharia para o Taxímetro Digital.
Itens marcados com 🔴 são pré-requisitos para confiabilidade em produção.
Itens com 🟡 melhoram experiência ou reduzem risco operacional.
Itens com 🟢 são melhorias desejáveis a médio prazo.

---

## Em andamento

Nenhum item em progresso no momento.

---

## Próximo ciclo (P0 — bloqueadores de confiabilidade)

### 🔴 Testes de integração com banco real
O CI roda `npm test` sem banco de dados — cobre apenas lógica pura.
Nenhum teste valida que as queries Drizzle, as políticas de domínio ou o
fluxo de check-in/checkout funcionam contra PostgreSQL real.

**Escopo mínimo:**
- Subir Postgres no CI via `services:` do GitHub Actions
- Testes para `attendance-window-policy` com dados reais
- Teste para `resolveCheckoutAssignmentIds` (unified checkout)
- Teste para `logAudit` persistindo corretamente

---

### 🔴 Validação de consistência do basePath no CI
`basePath: "/taximetro"` está acoplado em dezenas de `fetch` client-side.
Se alguém alterar `next.config.ts` sem atualizar os fetches → tela branca
silenciosa em produção (build passa, health check passa, app quebra).

**Escopo mínimo:**
- Script de lint que extrai `basePath` de `next.config.ts` e verifica que
  todos os `fetch("/taximetro/api/...")` no código são consistentes.
- Executado como passo no job `test`.

---

### 🔴 Alerta explícito se Telegram tokens estão vazios
Se `TELEGRAM_BOT_TOKEN_NEXT` for vazio ou inválido, o bot silenciosamente
faz fallback para o token revogado e interns perdem avisos de check-in.
Zero log, zero alerta.

**Escopo mínimo:**
- Ao iniciar, `src/lib/telegram.ts` loga warning se o token ativo parece
  inválido (vazio, muito curto, sem `:`)
- Endpoint `/api/health` expõe status do token (válido/ausente, sem expor
  o valor)

---

## Médio prazo (P1 — experiência e operabilidade)

### 🟡 Rate limiter via Redis (substituir in-memory)
O módulo `src/shared/infra/rate-limit/index.ts` foi desenhado para troca
fácil. Em um único container, o in-memory funciona. Se escalar ou reiniciar
o container, o estado se perde.

---

### 🟡 NPS de checkout visível no dashboard
Dados de `knowledge/proactivity/punctuality` (SAD/NEUTRAL/HAPPY) são
persistidos em `checkin.checkoutNotes` como string serializada. Não há UI
para visualizar ou agregar esse NPS.

**Escopo:** Parser do campo `NPS|knowledge=...;proactivity=...;punctuality=...`,
agregação por preceptor/base/período, exibição no dashboard admin.

---

### 🟡 Página de histórico de auditoria para o coordinator
`auditLog` é populado mas só acessível via API admin sem UI dedicada.

**Escopo:** Tabela paginada com filtros por usuário, ação, entidade e período.
Essencial para rastrear impersonation e ações manuais do coordinator.

---

### 🟡 Smoke test de login no CI
O canary healthcheck verifica apenas se o servidor responde — não se o
login funciona. Um teste de ponta-a-ponta mínimo (Playwright headless:
abre `/taximetro/login`, preenche credenciais, verifica redirect para
`/taximetro/admin`) pegaria regressões de autenticação antes do swap.

---

### 🟡 Centralizar DATABASE_URL sem fallback silencioso
`postgresql://localhost:5432/taximetro` está hardcoded como fallback em 5
arquivos (`drizzle.config.ts`, `seed.ts`, `seed-dev.ts`, `seed-prod.ts`,
`fix-coords.ts`). Se rodado sem `DATABASE_URL`, falha de forma confusa.

**Escopo:** Função utilitária `requireDatabaseUrl()` que lança erro explícito
se a variável não estiver definida. Usar em todos os 5 lugares.

---

## Longo prazo (P2 — produto)

### 🟢 App mobile (PWA ou React Native)
Interns usam o check-in no celular via browser. Uma PWA com câmera nativa
para selfie e geolocalização melhoraria a experiência significativamente.

---

### 🟢 Notificações push (Web Push / FCM)
Substituir ou complementar o Telegram por notificações push nativas no
browser/app para lembretes de check-in e aprovações de solicitação.

---

### 🟢 Relatórios exportáveis (PDF/CSV)
Coordenadores precisam de relatórios de presença por faculdade e período
para prestação de contas. Exportação de escala e histórico de check-ins.

---

### 🟢 Gestão de feriados e períodos letivos
Plantões em feriados nacionais/municipais não têm tratamento especial.
Configuração de períodos letivos por faculdade permitiria pausar/retomar
escala automaticamente.

---

### 🟢 Multi-tenancy (múltiplas cidades/UPAs)
Arquitetura atual é single-tenant (uma instalação = uma cidade). Adicionar
`organizationId` como isolamento permitiria replicar o produto para outras
coordenações de SAMU sem nova instância.

---

## Dívidas técnicas documentadas

| Item | Risco | Arquivo |
|------|-------|---------|
| `DATABASE_URL` fallback hardcoded em 5 arquivos | Moderado | `drizzle.config.ts`, `seed*.ts` |
| Crons configurados no entrypoint (1 execução) | Moderado | `container-entrypoint.sh` |
| `checkoutNotes` serializado como string | Baixo | `checkins` schema |
| Falta de índice em `assignments.date + status` | Baixo | Performance futura |
| `available_slots` como view materializada manual | Baixo | `scripts/materialized-view-*.sql` |
