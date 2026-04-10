# Data Flow

## Visão geral
Este documento descreve como os dados percorrem o sistema em produção e como evoluir fluxos sem regressão.

## Macrofluxo do sistema
1. Entrada
- UI web (interno, preceptor, líder, coordenação)
- Telegram webhook
- Jobs agendados no container (cron)

2. Aplicação
- Rotas em src/app/api recebem request, aplicam autenticação/autorização e executam regras.
- Regras estão em src/lib e parcialmente nas próprias rotas.

3. Persistência
- Drizzle ORM acessa PostgreSQL via src/db/index.ts.
- Tabelas e enums centralizados em src/db/schema.ts.

4. Saída
- JSON para UI
- Mensagens Telegram
- E-mails
- Logs de auditoria

---

## Fluxos críticos

## 1) Escala e alocação
Entrada:
- src/app/leader/escala/page.tsx chama endpoints de assignments e slots.

Processamento:
- src/app/api/assignments/route.ts
- Regras de capacidade e conflito em src/lib/slots.ts
- Regras CRU fixo em src/lib/cru-fixed.ts

Persistência:
- assignments, slot_rules, cru_fixed_assignments, audit_log

Saída:
- Lista de assignments por período/base
- Mensagens de conflito/capacidade

Pontos sensíveis:
- Conflito CRU/CRL ±12h
- Reativação de cancelados
- Regras por papel (leader/coordinator)

## 2) Check-in e validação de presença
Entrada:
- Interno: endpoints attendance/checkin
- Preceptor/Telegram: attendance/validate e telegram/webhook

Processamento:
- Geofence: src/lib/geo.ts
- TOTP: src/lib/totp.ts, src/lib/totp-config.ts
- Janela de horário: src/lib/utils.ts

Persistência:
- checkins, qr_sessions, assignments, audit_log

Saída:
- status de presença
- eventos SSE
- confirmação em grupo Telegram

Pontos sensíveis:
- Janela de validade de código
- Controle de base do validador
- Atualização de estado CHECKED_IN/CHECKED_OUT

## 3) Lembretes Telegram de pendência
Entrada:
- Cron no entrypoint do container
- Comando manual no Telegram (/pendencias)

Processamento:
- src/lib/telegram-checkin-pending-reminder.ts
- autorização por vínculo Telegram + role

Persistência:
- consulta assignments/checkins
- auditoria no audit_log

Saída:
- mensagem no grupo Telegram

Pontos sensíveis:
- Token/config Telegram
- Formatação de mensagem por base

---

## Fluxo de autorização
1. Middleware de rota por prefixo em src/middleware.ts
2. Validação de role e escopo dentro de cada endpoint API
3. Em fluxos com impersonação, uso de getEffectiveUser

Risco atual:
- Parte da autorização está no middleware e parte espalhada em rotas, aumentando chance de inconsistência.

---

## Fluxo de observabilidade e auditoria
- Eventos críticos usam src/lib/audit.ts
- Registro em audit_log com payload JSON
- Logs adicionais no runtime container (cron e servidor)

Recomendação de evolução:
- Definir catálogo de ações por feature e payload mínimo obrigatório.

---

## Como adicionar uma nova feature sem quebrar
1. Definir feature e fluxo de dados antes de codar
- Entrada esperada
- Regra de negócio
- Tabelas afetadas
- Saída/contrato

2. Implementar primeiro em application/domain (novo padrão)
- caso de uso isolado
- regras puras e determinísticas

3. Criar adapter em app/api
- parse/validação de payload
- auth/rbac
- chamada do caso de uso
- resposta HTTP estável

4. Integrar UI por contrato explícito
- evitar SQL direto em page.tsx
- evitar regra de negócio em componente visual

5. Instrumentar auditoria
- ação padronizada
- payload com ids e contexto de decisão

6. Validar smoke flow
- principal sucesso
- erros esperados
- cenário de permissão negada

---

## Como não quebrar o sistema
1. Não alterar shape de resposta de endpoint existente sem versionar ou migrar clientes.
2. Não mover regra crítica diretamente para UI.
3. Não remover validações de janela de horário, geofence e role.
4. Preservar basePath /taximetro em links e callbacks.
5. Em mudança de CRU e escala, validar sempre:
- alocação
- remoção
- reativação
- conflitos adjacentes

---

## Data flow alvo após modularização
1. app/api -> feature application use case
2. use case -> domain services/policies
3. use case -> infra repositories/gateways
4. presenter -> response DTO

Benefício para agentes IA:
- Entrada única por caso de uso
- Fronteiras claras entre regra e IO
- Menor custo cognitivo para editar com segurança
