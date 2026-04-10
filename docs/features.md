# Features

## Objetivo
Mapear funcionalidades atuais por domínio e orientar como evoluir cada uma no novo modelo por feature.

---

## Mapa de features atual

## 1) Attendance (Presença)
Escopo:
- Check-in, validação, checkout, observações, status em tempo real

Arquivos principais atuais:
- src/app/api/attendance/checkin/route.ts
- src/app/api/attendance/validate/route.ts
- src/app/api/attendance/checkout/route.ts
- src/app/api/attendance/current/route.ts
- src/lib/totp.ts
- src/lib/geo.ts
- src/lib/utils.ts

Entidades de dados:
- checkins
- qr_sessions
- assignments

Integrações:
- Telegram (validação)
- SSE (status)

## 2) Scheduling (Escala)
Escopo:
- Vagas, alocação, remanejamento, CRU fixo semanal, conflitos CRU/CRL

Arquivos principais atuais:
- src/app/api/assignments/route.ts
- src/app/api/slots/available/route.ts
- src/app/api/leader/cru-fixed/route.ts
- src/app/api/leader/cru-generate/route.ts
- src/lib/slots.ts
- src/lib/cru-fixed.ts

Entidades de dados:
- assignments
- slot_rules
- cru_fixed_assignments

## 3) Requests (Solicitações)
Escopo:
- troca, extra, desistência e histórico

Arquivos principais atuais:
- src/app/api/requests/route.ts
- src/app/api/requests/swap-history/route.ts

Entidades de dados:
- requests
- assignments

## 4) Users & Access (Usuários e acesso)
Escopo:
- autenticação, papéis, convite, cadastro, troca de senha, merge de usuários

Arquivos principais atuais:
- src/lib/auth.ts
- src/lib/impersonate.ts
- src/app/api/auth/*
- src/app/api/admin/users/*
- src/app/api/leader/interns/route.ts

Entidades de dados:
- users
- user_roles
- invite_links
- password_reset_tokens
- user_merge_events

## 5) Notifications (Telegram + Email)
Escopo:
- webhook do bot, vínculo Telegram, lembrete de pendência, reset de senha por e-mail

Arquivos principais atuais:
- src/app/api/telegram/webhook/route.ts
- src/app/api/telegram/checkin-pending-reminder/route.ts
- src/lib/telegram.ts
- src/lib/telegram-checkin-pending-reminder.ts
- src/lib/email.ts

Entidades de dados:
- telegram_bindings
- audit_log

## 6) Reporting/Admin Dashboard
Escopo:
- métricas operacionais, visão por base/faculdade, modais de detalhe

Arquivos principais atuais:
- src/app/admin/page.tsx
- src/components/admin-dashboard.tsx
- src/components/admin-filled-schedule.tsx

Entidades de dados:
- assignments/checkins/users/faculties/bases (queries agregadas)

---

## Estrutura alvo por feature

```text
src/features/
  attendance/
    application/use-cases/
    domain/{entities,services,policies}/
    infra/{repositories,gateways}/
    ui/{presenters,hooks}/
  scheduling/
  requests/
  users/
  notifications/
  reporting/
```

Convenção recomendada:
- Nomear use cases por verbo + contexto:
  - create-assignment.ts
  - validate-checkin.ts
  - send-pending-checkin-reminder.ts
- Nomear policies por regra:
  - cru-adjacent-conflict.policy.ts
  - attendance-window.policy.ts

---

## Plano de migração por feature (ordem segura)

## Fase A — Scheduling primeiro
Mover primeiro:
1. src/lib/slots.ts
2. src/lib/cru-fixed.ts
3. src/app/api/assignments/route.ts

Ajustes de dependência:
- Rotas importam use cases de features/scheduling/application
- use cases chamam repositories em features/scheduling/infra

Riscos:
- Regressão em conflito CRU/CRL
- Regressão em cancelamento/reativação

Mitigação:
- smoke test manual de leader/admin em escala

## Fase B — Attendance
Mover:
1. src/lib/totp.ts
2. src/lib/geo.ts
3. endpoints attendance

Riscos:
- Regressão em janela de check-in
- Regressão em validação Telegram

Mitigação:
- teste de ponta a ponta com check-in real e validação por código

## Fase C — Notifications
Mover:
1. src/lib/telegram-checkin-pending-reminder.ts
2. src/lib/telegram.ts
3. webhook route

Riscos:
- quebra de comandos no Telegram

Mitigação:
- validar mensagens em dry run e no grupo oficial

## Fase D — Reporting
Mover:
1. SQL e agregações de src/app/admin/page.tsx para reporting/application + infra

Riscos:
- quebra de shape esperado por componentes

Mitigação:
- preservar DTO do dashboard

---

## Como adicionar nova feature
1. Criar pasta em src/features/<nome-feature>
2. Definir entidade e políticas em domain
3. Criar use case em application
4. Criar repository/gateway em infra
5. Conectar route em app/api (adapter)
6. Expor DTO estável para UI
7. Adicionar auditoria para ações sensíveis

Checklist mínimo antes de merge:
- contrato HTTP documentado
- RBAC definido
- caminho feliz e erro conhecido cobertos por teste/smoke
- logs de auditoria validados

---

## Como não quebrar o sistema
1. Não remover arquivos antigos sem re-export temporário.
2. Não alterar endpoint em produção sem manter compatibilidade de payload.
3. Não misturar regra nova dentro de componente visual.
4. Não acessar db direto em page.tsx para regra de negócio nova.
5. Não introduzir integração externa sem gateway isolado.

---

## Resultado esperado após migração
- Agentes IA localizam regra por feature rapidamente.
- Mudanças em regra não exigem leitura de múltiplas rotas desconectadas.
- Menos regressão por acoplamento entre UI, API e persistência.
