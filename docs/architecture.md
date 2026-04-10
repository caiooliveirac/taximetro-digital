# Architecture

## Objetivo
Este documento descreve:
1. Diagnóstico estrutural atual (FASE 1)
2. Arquitetura alvo por domínio (FASE 2)
3. Plano de migração incremental e seguro (FASE 3)

O foco é aumentar compreensibilidade e editabilidade por agentes de IA sem quebrar produção.

---

## FASE 1 — Análise do estado atual

### Estrutura atual (resumo)
- src/app: páginas e endpoints API (Next.js App Router)
- src/components: componentes reutilizáveis de UI e telas complexas
- src/lib: regras de negócio, auth, utilidades, integrações e validações
- src/db: schema Drizzle, conexão e seeds

### Onde estão as regras de negócio hoje
- Escala, vagas e conflito CRU/CRL: src/lib/slots.ts
- CRU fixo semanal e materialização: src/lib/cru-fixed.ts
- Regras de presença/check-in/checkout e janelas de turno: src/lib/utils.ts + endpoints em src/app/api/attendance/*
- Regras de autorização efetiva (impersonação): src/lib/impersonate.ts
- Regras de autenticação e sessão: src/lib/auth.ts
- Regras de requisições (troca, extra, desistência): src/app/api/requests/route.ts
- Regras de alocação/cancelamento de assignment: src/app/api/assignments/route.ts

### Onde estão integrações externas
- Banco PostgreSQL (Drizzle): src/db/index.ts, src/db/schema.ts
- Telegram Bot e comandos: src/lib/telegram.ts, src/app/api/telegram/webhook/route.ts
- Lembrete pendências Telegram: src/lib/telegram-checkin-pending-reminder.ts
- E-mail (reset senha): src/lib/email.ts
- SSE para atualização em tempo real: src/lib/sse.ts e src/app/api/attendance/status/[assignmentId]/route.ts
- Cron em runtime de container: scripts/container-entrypoint.sh

### Onde há acoplamento UI + lógica
- Páginas server-side com SQL inline e transformação de dados de dashboard:
  - src/app/admin/page.tsx
  - src/app/intern/bases/page.tsx
- Endpoints de API acumulam validação, autorização, regra de negócio e persistência no mesmo arquivo:
  - src/app/api/assignments/route.ts
  - src/app/api/attendance/checkin/route.ts
  - src/app/api/telegram/webhook/route.ts
- Componentes grandes de UI com regra operacional embutida:
  - src/components/admin-dashboard.tsx
  - src/components/admin-filled-schedule.tsx

### Problemas estruturais encontrados
1. Camadas misturadas:
   - Muitas rotas API fazem auth + regra + query SQL + formatação da resposta no mesmo arquivo.
2. Reuso de regra dependente de leitura manual:
   - Regras espalhadas entre src/lib e rotas, sem contratos explícitos por feature.
3. Fronteiras de domínio não explícitas:
   - Conceitos como attendance, scheduling, requests, users estão misturados em src/lib e src/app/api.
4. Dificuldade para agentes IA:
   - Não há pasta de feature com entrada única de casos de uso.
   - Falta de convenções de nome para application/domain/infra/ui.
5. Baixa testabilidade:
   - Muita lógica acoplada a NextRequest/NextResponse e db diretamente.
6. Risco de regressão ao editar:
   - Alterações em uma rota tendem a mexer em regra crítica sem isolamento.

---

## FASE 2 — Proposta de arquitetura alvo

## Princípios
- Organizar por feature/domínio primeiro.
- Separar responsabilidades:
  - application: casos de uso
  - domain: entidades, regras e serviços puros
  - infra: persistência, gateways externos
  - ui: páginas, componentes e adapters de requisição
- Manter compatibilidade progressiva com estrutura atual.

## Estrutura sugerida

```text
src/
  app/                       # Next.js routes/pages (adaptadores de entrada)
  features/
    attendance/
      application/
        use-cases/
        dto/
      domain/
        entities/
        services/
        policies/
      infra/
        repositories/
        gateways/
      ui/
        presenters/
        hooks/
    scheduling/
      application/
      domain/
      infra/
      ui/
    requests/
      application/
      domain/
      infra/
      ui/
    users/
      application/
      domain/
      infra/
      ui/
    notifications/
      application/
      domain/
      infra/
      ui/
  shared/
    db/
      client.ts
      schema.ts
      migrations/
    auth/
      session.ts
      rbac.ts
    infra/
      logger/
      time/
      validation/
    ui/
      components/
      tokens/
```

## Mapeamento direto (atual -> alvo)
- src/lib/slots.ts -> src/features/scheduling/domain/services/slot-policies.ts
- src/lib/cru-fixed.ts -> src/features/scheduling/application/use-cases/cru-fixed/* + domain
- src/lib/auth.ts -> src/shared/auth/session.ts + src/features/users/application/auth/*
- src/lib/telegram*.ts -> src/features/notifications/infra/telegram/*
- src/app/api/assignments/route.ts -> src/features/scheduling/application/use-cases/* + app/api adapter
- src/app/admin/page.tsx -> src/features/attendance/application/use-cases/get-admin-dashboard.ts + ui presenter

## Regras de design para novas features
1. Toda regra de negócio nova deve nascer em domain ou application.
2. app/api deve apenas:
   - autenticar/autorização de entrada
   - validar payload
   - chamar use case
   - mapear resposta HTTP
3. Acesso ao banco via repositories em infra, não direto em page.tsx ou componentes.
4. Integrações externas somente via gateways (Telegram, e-mail, etc).

---

## FASE 3 — Plano de migração incremental (sem quebrar produção)

## Estratégia geral
- Strangler pattern: criar camada nova em paralelo, migrando endpoint por endpoint.
- Não mover tudo de uma vez.
- Cada etapa deve preservar contratos HTTP e formatos JSON atuais.

## Etapa 0 — Preparação (baixo risco)
1. Criar estrutura de pastas src/features e src/shared.
2. Criar guidelines de arquitetura (este documento + data-flow + features).
3. Congelar mudanças estruturais grandes fora da trilha de migração.

Risco: baixo.
Mitigação: sem impacto runtime.

## Etapa 1 — Shared foundation
Arquivos a mover/copy-first:
1. src/db/index.ts -> src/shared/db/client.ts
2. src/db/schema.ts -> src/shared/db/schema.ts
3. src/lib/utils.ts (partes infra genéricas) -> src/shared/infra/time/* e src/shared/infra/strings/*
4. src/lib/audit.ts -> src/shared/infra/logger/audit.ts

Dependências a ajustar:
- Aliases de import para novo caminho.
- Export barrel temporário no caminho antigo para evitar quebra imediata.

Risco: médio (imports em muitas rotas).
Mitigação: manter re-export compatível nos arquivos antigos durante transição.

## Etapa 2 — Scheduling (primeiro domínio crítico, alto valor)
Arquivos prioritários:
1. src/lib/slots.ts
2. src/lib/cru-fixed.ts
3. src/app/api/assignments/route.ts
4. src/app/api/leader/cru-fixed/route.ts
5. src/app/api/leader/cru-generate/route.ts

Ações:
- Extrair casos de uso:
  - createAssignment
  - updateAssignmentStatus
  - generateCruFixed
  - removeCruFixed
- Introduzir repositories para assignments/slotRules.
- Rotas atuais viram adaptadores thin.

Risco: alto (regras sensíveis de produção).
Mitigação:
- Migrar endpoint por endpoint.
- Validar payloads e respostas equivalentes.
- Smoke test manual em alocação, remoção e CRU fixo.

## Etapa 3 — Attendance
Arquivos prioritários:
1. src/app/api/attendance/checkin/route.ts
2. src/app/api/attendance/validate/route.ts
3. src/app/api/attendance/checkout/route.ts
4. src/app/api/attendance/current/route.ts
5. src/lib/totp.ts, src/lib/geo.ts

Ações:
- Casos de uso de check-in/validação/checkout.
- Gateway de TOTP e geofence separados.
- SSE mantido no adapter HTTP.

Risco: alto (fluxo operacional em tempo real).
Mitigação:
- Flags de execução por endpoint (legacy vs novo).
- Rollback rápido para handler legado.

## Etapa 4 — Notifications (Telegram + Email)
Arquivos prioritários:
1. src/app/api/telegram/webhook/route.ts
2. src/lib/telegram.ts
3. src/lib/telegram-checkin-pending-reminder.ts
4. src/lib/email.ts

Ações:
- Criar notification gateways (telegram/email).
- Separar parser de comando Telegram da regra de negócio.
- Agendamento cron continua igual no container-entrypoint.

Risco: médio.
Mitigação:
- Snapshot de payloads de mensagem para validar compatibilidade.

## Etapa 5 — Dashboards e páginas com SQL inline
Arquivos prioritários:
1. src/app/admin/page.tsx
2. src/app/intern/bases/page.tsx
3. componentes com transformação pesada de dados

Ações:
- Extrair query services/repositories para feature apropriada.
- Page.tsx vira composição de loader + presenter.

Risco: médio.
Mitigação:
- Preservar shape do objeto entregue para componentes existentes.

## Etapa 6 — Limpeza final
1. Remover re-exports temporários de src/lib e src/db antigos.
2. Atualizar README com nova estrutura.
3. Checklist de contribuição para agentes IA.

Risco: baixo.
Mitigação: somente após migração completa.

---

## Ordem recomendada de primeiros arquivos para mover
1. src/db/index.ts
2. src/db/schema.ts
3. src/lib/audit.ts
4. src/lib/slots.ts
5. src/lib/cru-fixed.ts
6. src/app/api/assignments/route.ts

Motivo: maior ganho de clareza com menor impacto inicial em UI.

---

## Critérios de pronto por etapa
- Sem mudança de contrato HTTP externo.
- Sem mudança em variáveis de ambiente obrigatórias.
- Build e deploy do container sem alterações no Dockerfile/entrypoint.
- Smoke test operacional validado:
  - login
  - alocação
  - check-in
  - validação
  - checkout
  - lembrete Telegram

---

## Decisões de segurança para não quebrar produção
1. Migração sem big-bang.
2. Re-export temporário para compatibilidade de import.
3. Preservar rotas e payloads públicos.
4. Mudança de comportamento somente com validação explícita.
