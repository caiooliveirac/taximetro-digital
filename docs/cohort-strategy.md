# Estratégia: Turmas como entidade de primeira classe + Relatório de Fechamento

> **Status:** proposta de refatoração — ainda não implementada.  
> **Audiência:** próximos agentes (Codex/Claude) e devs humanos que pegarem a branch de implementação.  
> **Pré-requisito de leitura:** [AGENTS.md](../AGENTS.md), [docs/runtime-truth.md](runtime-truth.md), [docs/rotation-boundary-fix.md](rotation-boundary-fix.md), [src/lib/admin-report-builder.ts](../src/lib/admin-report-builder.ts).

---

## 0. TL;DR

Hoje a aplicação **infere** a turma de cada intern por heurística de janela de 49 dias (`ROTATION_WINDOW_DAYS`) ancorada em `faculties.rotationStartDate` ou no primeiro plantão. Isso causa bugs de borda (ex.: caso Bruna Bastos / CRU) e torna o relatório de fechamento de turma frágil porque ele depende de um `cohortLabel` calculado em runtime e que pode mudar quando dados são corrigidos.

A proposta é tornar **turma (cohort)** uma entidade explícita e vincular cada intern a uma turma desde o cadastro, eliminando a inferência. O relatório de fechamento passa a ser um snapshot imutável dessa turma.

---

## 1. Estado atual (verdade)

### 1.1 Tabelas relevantes hoje
| Tabela | Papel atual | Limitação |
|---|---|---|
| `faculties` | tem `rotationStartDate` (date, default `now()`) | uma única âncora por faculdade; não modela rodízios sucessivos |
| `rotation_transitions` | `(facultyId, rotationNumber, startDate, endDate, label)` | já é "turma por faculdade", mas é só uma janela; não tem status, não é vinculada a internos, não tem snapshot de fechamento |
| `user_roles` | tem `facultyId` por intern | **não tem `cohortId`** — não dá para responder "de qual turma esse intern é?" sem inferir |
| `assignments` | tem `facultyId`, `internId`, `date` | turma é deduzida de `(facultyId, date)` cruzando com `rotation_transitions` |
| `invite_links` | tem `facultyId` opcional | **não tem `cohortId`** — invite não pré-define turma |

### 1.2 Como o relatório infere turma hoje
Arquivo: [src/lib/admin-report-builder.ts](../src/lib/admin-report-builder.ts)

Função `buildRotationCohort(executionDate, facultyId, fallbackAnchorDate)`:
1. Tenta `getRotationTransition(date, facultyId)` → bate em `rotation_transitions` por janela.
2. **Fallback (49 dias):** calcula `windowIndex = floor((execDate - anchor) / 49)` e gera label `"Turma {N} ({startShort}-{endShort})"`.

Função `getCohortForIntern(intern, grouping)`:
- `MONTH` → cohort por mês de criação do `users.createdAt` (não tem nada a ver com rodízio real).
- `SEMESTER` → mapeado **retroativamente** para `cohortRotationKey` (heurística).
- `ROTATION_7W` → mesma heurística da janela de 49 dias.

**Comentário do próprio código** (linha ~540):
```
// TODO: substituir essa heurística por um campo explícito cohort no schema.
```

### 1.3 Dores observáveis
- **Boundary bug** documentado em [docs/rotation-boundary-fix.md](rotation-boundary-fix.md): internos que entram fora do ciclo somem da turma.
- **Relatório não-determinístico:** rodar o relatório em dias diferentes pode mudar o `cohortLabel` se algum dado for corrigido.
- **Fechamento sem snapshot:** não existe entidade que diga "esta turma foi fechada nesta data com este resultado". Ao reabrir o relatório no futuro, ele recalcula com dados atuais (não com os dados do dia do fechamento).
- **Cadastro burro:** intern entra com `facultyId` mas sem turma; alocação só "vira realidade" quando ganha o primeiro `assignment`.

---

## 2. Modelo proposto

### 2.1 Nova tabela `cohorts` (turma como entidade)

```ts
export const cohortStatusEnum = pgEnum("cohort_status", [
  "PLANNED",  // criada, ainda sem internos ativos
  "ACTIVE",   // rodízio em andamento
  "CLOSED",   // fechada com snapshot imutável
]);

export const cohorts = pgTable("cohorts", {
  id: uuid("id").primaryKey().defaultRandom(),
  facultyId: uuid("faculty_id").notNull().references(() => faculties.id),
  rotationNumber: integer("rotation_number").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  status: cohortStatusEnum("status").notNull().default("PLANNED"),
  closedAt: timestamp("closed_at"),
  closedBy: uuid("closed_by").references(() => users.id),
  closingReportSnapshot: jsonb("closing_report_snapshot"), // ReportDocument serializado
  closingReportHtml: text("closing_report_html"),          // HTML imutável (reaproveita attendance-report-html)
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uq_cohort_faculty_rotation").on(t.facultyId, t.rotationNumber),
  index("idx_cohort_faculty_status").on(t.facultyId, t.status),
  index("idx_cohort_dates").on(t.startDate, t.endDate),
]);
```

**Invariantes**
- `endDate >= startDate` (CHECK no banco).
- No máximo **uma** cohort `ACTIVE` por `facultyId` em um dado momento (validação aplicacional, não constraint — para permitir overlap controlado de transição).
- `CLOSED` é terminal: não pode voltar para `ACTIVE`. Se precisar reabrir, criar nova cohort com `rotationNumber` ajustado.
- `closingReportSnapshot` é write-once: setado apenas na transição → `CLOSED`.

**Relação com `rotation_transitions`**
- `rotation_transitions` tem o **mesmo grão** de `cohorts` (faculty + rotation). Plano: backfill 1-para-1 e descontinuar a tabela antiga (depois que ninguém ler mais dela).

### 2.2 Vínculo intern → cohort

**Decisão: coluna em `user_roles`**, não em `users`.

```ts
// adicionar em userRoles:
cohortId: uuid("cohort_id").references(() => cohorts.id), // nullable durante migração; NOT NULL após backfill
```

**Por quê em `user_roles`?**
- Já é onde mora `facultyId`. `cohortId` é especialização de `facultyId`.
- Suporta histórico: intern que muda de turma vira **novo** `userRoles` com `isArchived=true` no antigo (padrão já usado).
- Não polui `users` com lógica que só faz sentido para `role=INTERN`.

**Constraint de coerência**
- `cohort.facultyId` precisa ser igual ao `userRoles.facultyId`. Validar na aplicação (Drizzle não expressa).

### 2.3 `assignments.cohortId` — adicionar?

**Decisão inicial: NÃO adicionar.** O par `(internId, date)` resolvido contra `userRoles.cohortId` é suficiente, **desde que** trocas de turma sejam feitas via novo `userRoles` (com data de validade — ver §2.4).

**Reavaliar em F4** se aparecer caso real de intern que troca de turma no meio do rodízio com plantões antes/depois precisando de turmas distintas.

### 2.4 Histórico de troca de turma (opcional, fase posterior)

Se for necessário versionar (intern muda de cohort 5 no meio do rodízio):
- Adicionar `userRoles.validFrom` / `validUntil` (date), ou
- Tabela `intern_cohort_history (internId, cohortId, validFrom, validUntil)`.

Não bloquear a fase 1 com isso — entrar só quando aparecer caso real.

### 2.5 `invite_links.cohortId`

```ts
// adicionar em inviteLinks:
cohortId: uuid("cohort_id").references(() => cohorts.id), // nullable
```

Quando o invite é criado já com cohort, o cadastro do intern grava `userRoles.cohortId` direto. Sem inferência.

---

## 3. Migrações Drizzle (ordem)

> Numeração presumida — ajustar conforme `drizzle/meta/_journal.json` no momento da PR.

### `0015_cohorts_table.sql`
```sql
CREATE TYPE cohort_status AS ENUM ('PLANNED','ACTIVE','CLOSED');

CREATE TABLE cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id uuid NOT NULL REFERENCES faculties(id),
  rotation_number integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  label varchar(255) NOT NULL,
  status cohort_status NOT NULL DEFAULT 'PLANNED',
  closed_at timestamp,
  closed_by uuid REFERENCES users(id),
  closing_report_snapshot jsonb,
  closing_report_html text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_cohort_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_cohort_closed_consistency CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
    OR status <> 'CLOSED'
  )
);

CREATE UNIQUE INDEX uq_cohort_faculty_rotation ON cohorts(faculty_id, rotation_number);
CREATE INDEX idx_cohort_faculty_status ON cohorts(faculty_id, status);
CREATE INDEX idx_cohort_dates ON cohorts(start_date, end_date);
```

### `0016_backfill_cohorts_from_rotation_transitions.sql`
```sql
-- COORDINATOR system user precisa existir; usar fallback (primeiro COORDINATOR ativo)
INSERT INTO cohorts (
  faculty_id, rotation_number, start_date, end_date, label,
  status, created_by, created_at
)
SELECT
  rt.faculty_id,
  rt.rotation_number,
  rt.start_date,
  rt.end_date,
  COALESCE(rt.label, 'Turma ' || rt.rotation_number),
  CASE
    WHEN rt.end_date < CURRENT_DATE THEN 'PLANNED'  -- não fechamos automaticamente; só admin fecha
    WHEN rt.start_date <= CURRENT_DATE AND rt.end_date >= CURRENT_DATE THEN 'ACTIVE'
    ELSE 'PLANNED'
  END,
  (SELECT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.role = 'COORDINATOR' AND ur.is_active = true
    ORDER BY u.created_at ASC LIMIT 1),
  rt.created_at
FROM rotation_transitions rt
ON CONFLICT (faculty_id, rotation_number) DO NOTHING;
```

> **Atenção:** decisão deliberada de **não** auto-fechar turmas históricas. `CLOSED` exige relatório de fechamento gerado pelo coordenador (ver §4). Turmas passadas ficam `PLANNED` até alguém fechar manualmente, ou definimos um status adicional `ARCHIVED` em fase posterior.

### `0017_user_roles_cohort_id.sql`
```sql
ALTER TABLE user_roles ADD COLUMN cohort_id uuid REFERENCES cohorts(id);
CREATE INDEX idx_user_roles_cohort ON user_roles(cohort_id);
```

### `0018_backfill_user_roles_cohort_id.sql`
Backfill via heurística atual (`buildRotationCohort` portado para SQL ou script Node):
- Para cada `userRoles` com `role='INTERN'` e `facultyId` não nulo:
  - Achar primeiro `assignment` do intern naquela faculdade.
  - Cruzar com `cohorts` por janela de data.
  - Se não cair em nenhuma cohort, deixar `NULL` e listar para revisão manual.

Script: `scripts/backfill-cohort-id.mjs` (não roda em produção sem dry-run primeiro).

### `0019_invite_links_cohort_id.sql`
```sql
ALTER TABLE invite_links ADD COLUMN cohort_id uuid REFERENCES cohorts(id);
```

### `0020_user_roles_cohort_id_not_null.sql` (apenas após 100% de backfill validado)
```sql
ALTER TABLE user_roles ALTER COLUMN cohort_id SET NOT NULL;
-- ⚠️ falha se houver INTERN sem cohort_id; rodar query de validação antes
```

---

## 4. Relatório de Fechamento de Turma

### 4.1 Fluxo

1. **Tela:** `/admin/relatorios` ganha card **"Fechamento de turma"** ao lado da exploração existente.
2. **Seleção:** dropdown `Faculdade → Turma` (lista `cohorts WHERE status IN ('ACTIVE','PLANNED')`).
3. **Preview:** invoca `generateAdminReport` com filtro `scopeMode='COHORT'` ancorado em `cohortId` (não label).
4. **Conteúdo do preview** (já temos quase tudo):
   - Cabeçalho da turma (faculty, rotation, datas, número de internos).
   - Para cada intern: % meta horas/plantões, faltas, casos atendidos, troca/extras pendentes/rejeitadas.
   - Heatmap.
   - Lista "Abaixo da meta" com flag para revisão.
5. **Ação `Fechar turma`** (apenas COORDINATOR):
   - `POST /api/admin/cohorts/:id/close`
   - Validações: status não pode ser `CLOSED`; data atual ≥ `endDate` (ou flag `force=true` com motivo).
   - Persiste:
     - `cohorts.status = 'CLOSED'`
     - `cohorts.closedAt = now()`, `closedBy = userId`
     - `cohorts.closingReportSnapshot = ReportDocument` (jsonb)
     - `cohorts.closingReportHtml = renderAttendanceReportHtml(doc)` (text)
   - Audit log: `entity='cohort'`, `action='CLOSE'`, `entityId=cohortId`, `payload={internCount, ...}`.
6. **Pós-fechamento:** GET na mesma turma retorna o snapshot. UI desabilita reprocessamento. Botão "Baixar HTML/PDF" usa `closingReportHtml`.

### 4.2 Idempotência e segurança
- Endpoint `close` é PUT/POST com `If-Match` lógico: aceita só se `status != 'CLOSED'`. Segunda chamada retorna 409.
- Nunca sobrescrever `closingReportSnapshot`. Se precisar reemitir → criar nova cohort com `rotationNumber+0.1`? **Não.** Política: snapshot é canônico; correções viram nota de errata em `cohorts.notes` + audit log.
- Reabrir turma fechada: **não permitido por API**. Só via SQL manual com aprovação do coordenador.

### 4.3 Onde colocar o código
- Endpoint: `src/app/api/admin/cohorts/[id]/close/route.ts`
- Listagem: `src/app/api/admin/cohorts/route.ts` (GET com filtros) + `POST` para criar
- UI: `src/app/admin/turmas/page.tsx` (CRUD) + integração na `/admin/relatorios` via `<CohortClosingCard />`
- Builder: estender `src/lib/admin-report-builder.ts` com `generateCohortReport(cohortId)` que prepara `ReportFilterInput` a partir da cohort.

---

## 5. Refator do `admin-report-builder.ts`

### 5.1 Mudanças por fase

**Fase 3 (heurística vira fallback rotulado):**

```ts
// pseudo
if (intern.userRoles.cohortId) {
  const cohort = await getCohortById(intern.userRoles.cohortId);
  return { key: cohort.id, label: cohort.label, source: 'EXPLICIT' };
}
// fallback antigo (49d window)
return { key: ..., label: `${heuristicLabel} (inferido)`, source: 'INFERRED' };
```

UI mostra badge "inferido" para qualquer intern sem `cohortId` explícito.

**Fase 5 (remover heurística):**
- `buildRotationCohort` deletado.
- `getCohortForIntern` lê só `userRoles.cohortId`.
- `cohortMonthKey` (cohort por mês de criação) **mantido** como agrupamento alternativo de UI, mas marcado como "não-oficial".

### 5.2 Pontos de atenção
- `ROTATION_WINDOW_DAYS = 49` está hardcoded; ao remover, garantir que nenhum teste de `tests/` depende disso.
- `rotation_transitions` continua existindo durante toda a transição. Drop só após Fase 5 + janela de 30 dias sem leitura (instrumentar com log).

---

## 6. Cadastro de intern com cohort

### 6.1 Fluxo via invite (preferencial)
1. COORDINATOR cria invite em `/admin/usuarios/convite` escolhendo `faculty + cohort`.
2. `inviteLinks.cohortId` salvo.
3. Intern acessa `/registro/[token]` → cadastro → `userRoles.facultyId` e `userRoles.cohortId` populados a partir do invite.

### 6.2 Fluxo manual (criação direta pelo admin)
- Tela `/admin/usuarios/novo` ganha campo obrigatório `cohort` (filtra por faculty selecionada, status `ACTIVE`/`PLANNED`).

### 6.3 Migração de internos existentes sem cohort
- Tela `/admin/turmas/atribuir` (em massa): seleciona faculty → mostra internos sem `cohortId` → permite atribuir em lote a uma cohort.
- Bloqueio: `0020_*_not_null.sql` só roda quando query `SELECT count(*) FROM user_roles WHERE role='INTERN' AND cohort_id IS NULL AND is_active = true AND is_archived = false` retornar 0.

---

## 7. Plano de execução faseado

| Fase | Conteúdo | PRs sugeridos | Risco | Reversível? |
|---|---|---|---|---|
| **F0** | Esta documentação | já feito | nenhum | sim |
| **F1** | Migration `cohorts` + backfill from `rotation_transitions` + admin CRUD básico de turmas | PR-1, PR-2 | médio | sim (drop table) |
| **F2** | `userRoles.cohortId` nullable + backfill + UI de atribuição em massa | PR-3, PR-4 | médio | sim |
| **F3** | `inviteLinks.cohortId` + fluxo de invite + tela admin de criação manual | PR-5 | baixo | sim |
| **F4** | `admin-report-builder` lê `cohortId` quando presente; heurística vira fallback "(inferido)" | PR-6 | baixo | sim |
| **F5** | Card "Fechamento de turma" em `/admin/relatorios` + endpoint `close` + snapshot imutável | PR-7 | médio | parcial (snapshots persistidos) |
| **F6** | `userRoles.cohortId NOT NULL` + remoção da heurística + drop `rotation_transitions` | PR-8, PR-9 | baixo | difícil (requer recriar coluna) |

### 7.1 Critérios de pronto por fase
- **F1 OK quando:** `SELECT count(*) FROM cohorts` ≥ `SELECT count(*) FROM rotation_transitions`; admin consegue criar/editar turma na UI.
- **F2 OK quando:** `SELECT count(*) FROM user_roles WHERE role='INTERN' AND cohort_id IS NULL AND is_active=true AND is_archived=false` = 0.
- **F4 OK quando:** relatório com `userRoles.cohortId` populado **não** chama `buildRotationCohort` (instrumentar com log).
- **F5 OK quando:** turma fechada renderiza HTML idêntico após 7 dias mesmo com novos plantões inseridos retroativamente.
- **F6 OK quando:** grep por `rotationTransitions` no código retorna 0 ocorrências fora de migrations.

---

## 8. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Backfill de `cohortId` deixa internos sem turma | alta | médio | Tela de atribuição em massa antes do `NOT NULL`; instrumentar log de "intern sem cohort" |
| Snapshot do fechamento muito grande (jsonb) | média | baixo | Manter `closingReportHtml` como text comprimido (gzip + base64) se virar problema; jsonb tem compressão TOAST nativa |
| Coordenador fecha turma errada | média | alto | Confirmação dupla + audit log + endpoint manual de "marcar como reaberta" via SQL |
| `rotation_transitions` ainda lida em algum lugar não mapeado | média | médio | Antes de F6, instrumentar com log de leitura por 30 dias |
| Intern muda de turma no meio | baixa | médio | F2/F3 não cobrem; abrir issue separada para histórico (§2.4) se aparecer caso real |
| basePath quebra em novas rotas `/admin/turmas` | alta | crítico | seguir [AGENTS.md §5 risco #1](../AGENTS.md): incluir `/taximetro/` em todos os fetches client; cobrir com `tests/deploy-guardrails.test.ts` |

---

## 9. Casos de borda já mapeados

1. **Intern transferido entre faculdades** → atualmente vira novo `userRoles` (antigo arquivado). Mantém o padrão: novo `userRoles` ganha `cohortId` da nova faculty.
2. **Turma sem internos ainda** → `cohort.status='PLANNED'`, aparece no admin mas não em relatórios de execução.
3. **Plantão extra fora da janela da turma** → continua linkado pelo `internId`; relatório agrega na cohort do intern (não na cohort da data).
4. **Intern com plantão antes do `cohort.startDate`** → flag de aviso no relatório ("plantões fora da janela da turma"); não quebra agregação.
5. **Coordenador deleta turma com internos** → bloquear (FK `userRoles.cohortId`); só permitir se status `PLANNED` e zero internos.

---

## 10. Testes mínimos (a criar nas PRs)

- `tests/cohort-crud.test.ts`: criar/editar/deletar turma com validações de invariante.
- `tests/cohort-report.test.ts`: snapshot do `ReportDocument` para uma cohort estável; rodar duas vezes deve retornar idêntico.
- `tests/cohort-close.test.ts`: fechar turma → endpoint retorna 409 na segunda chamada; snapshot persistido bate byte-a-byte na releitura.
- `tests/cohort-backfill.test.ts`: rodar backfill em fixtures conhecidas → todos os internos ganham `cohortId` previsível.
- Estender `tests/deploy-guardrails.test.ts`: novas rotas `/admin/turmas/*` consistentes com basePath.

---

## 11. O que **não** está no escopo desta refatoração

- Cohort multi-faculdade (uma turma agregando duas faculdades simultâneas).
- Versionamento histórico de troca de turma com plantões "antes/depois" em cohorts diferentes (§2.4).
- Substituir `cohortMonthKey` (cohort por mês de criação) — fica como agrupamento alternativo de UI.
- Migrar `rotation_start_date` em `faculties` (mantém como metadado da faculdade até F6).

---

## 12. Referências internas

- [src/db/schema.ts](../src/db/schema.ts) — schema atual (linhas 322–334 = `rotation_transitions`).
- [src/lib/admin-report-builder.ts](../src/lib/admin-report-builder.ts) — heurística atual (linhas 296–390).
- [src/lib/attendance-report-html.ts](../src/lib/attendance-report-html.ts) — render HTML reutilizado pelo snapshot.
- [docs/rotation-boundary-fix.md](rotation-boundary-fix.md) — bug que motiva esta refatoração.
- [drizzle/0012_rotation_start_date.sql](../drizzle/0012_rotation_start_date.sql), [drizzle/0001_rotation_transitions.sql](../drizzle/0001_rotation_transitions.sql) — migrations relacionadas.
