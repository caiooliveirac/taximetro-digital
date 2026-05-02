# Plano — `feat/ux-admin-cockpit`

Branch: `feat/ux-admin-cockpit` (atual)
Referencia: [UX-PRINCIPLES.md](./UX-PRINCIPLES.md), [PROMPTUX.md](./PROMPTUX.md)

---

## Objetivo

Transformar `/admin` de "dashboard de auditoria" em **cockpit
operacional** que responde em ≤3s a pergunta única do coordenador:

> "Preciso intervir em algum interno HOJE?"

---

## Escopo

### O que muda
1. **Tela `/admin`** ganha bloco "Alarmes" no topo, antes dos KPIs atuais.
2. **3 alarmes core** ativos em ordem de urgência (definições precisas em
   "Definição de cada alarme" abaixo). O 4º alarme ("não vai bater no
   tempo") foi **diferido** pra branch dedicada — ver "Conceito de
   semana frágil" abaixo.
   1. **Sem check-in agora** (tempo real)
   2. **Faltou sem reposição** (`totalAbsent > 0 && (totalCompleted + futureScheduled) < targetShifts`)
   3. **Abaixo da meta semanal** (`belowWeeklyTarget === true`, com caveat per faculdade)
3. **Sidebar admin** levemente reorganizada — `Bases` sai de "Operação"
   para "Estrutura" (é config, não rotina diária).
4. **Tela atual** (rosters, per-base, weekly rate) **permanece** abaixo
   dos alarmes como segunda camada — não é descartada.

### O que NÃO muda nesta branch
- Componente "velocímetro de turma" no card do interno → branch #2
  (`feat/ux-velocimeter-card`). Aqui usamos só os números agregados.
- Tela de check-in do interno → branch #4.
- Tela do líder em mobile → branch #3.
- Tela do preceptor → branch #5.
- Lógica de cálculo de meta — **reusa** `executeGetComplianceOverview`
  como está. Se descobrirmos que precisa ajuste, vira issue separada.

---

## Composição da tela `/admin` (proposta)

```
┌─────────────────────────────────────────────────────────────────┐
│  Cockpit · 2 mai 2026 · {hora}        [filtro faculdade ▾]      │
├─────────────────────────────────────────────────────────────────┤
│  ALARMES ATIVOS                                                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                   │
│  │  Sem       │ │  Faltou    │ │  Abaixo    │                   │
│  │  check-in  │ │  s/ repo   │ │  da meta   │                   │
│  │  agora     │ │            │ │  semanal ⓘ │                   │
│  │   3        │ │   2        │ │   7        │                   │
│  │  vermelho  │ │  vermelho  │ │  amber     │                   │
│  └────────────┘ └────────────┘ └────────────┘                   │
│  (cada card → expande lista compacta clicável → /admin/ver-int) │
│  (ⓘ alarme 3 tem tooltip sobre caveat por faculdade)            │
├─────────────────────────────────────────────────────────────────┤
│  RESUMO DO DIA                                                  │
│  [Check-in rate] [Roster hoje] [Por base] (atual, reorganizado) │
├─────────────────────────────────────────────────────────────────┤
│  SEMANA                                                         │
│  [Week rate] [Week days strip] (atual, reduzido em altura)      │
└─────────────────────────────────────────────────────────────────┘
```

**Estado vazio do bloco Alarmes**:
> "✅ Sem alarmes ativos — todos os internos estão no ritmo."

(verde discreto, ocupando a altura de 1 card; resumo do dia some pra
cima)

---

## Implementação — passos para Sonnet (ou Opus auto-executando)

### Passo 0 — Branch e docs (já feito neste turno)
- ✅ Branch `feat/ux-admin-cockpit` criada
- ✅ `docs/UX-PRINCIPLES.md` escrito
- ✅ `docs/PLAN-admin-cockpit.md` escrito (este arquivo)
- ⏭ Aguardar revisão do Caio antes de codar

### Passo 1 — Definição de cada alarme (RESOLVIDO — sem código novo)

A partir do output de `executeGetComplianceOverview` por intern:

| Alarme | Cor | Condição | Fonte | Faculty-agnostic? |
|---|---|---|---|---|
| Sem check-in agora | red | `assignment.date = hoje` AND `status NOT IN ('CHECKED_IN','CHECKED_OUT','ABSENT','CANCELLED')` AND janela aberta | `fetchDashboardData` (existe) ou enriquecer query | ✅ |
| Faltou sem reposição | red | `intern.totalAbsent > 0 && (intern.totalCompleted + intern.futureScheduled) < intern.targetShifts` | `executeGetComplianceOverview` | ✅ |
| Abaixo da meta semanal | amber | `intern.belowWeeklyTarget === true` (= `lastWeekCompleted < weeklyTarget`) | idem | ⚠️ caveat (ver abaixo) |

**Por que a definição reformulada do alarme 2** (em vez do `netDeficit`):
- `(totalCompleted + futureScheduled) < targetShifts` significa "já feito + agendado não bate o alvo"
- Funciona pra **ZARNS** (alocação completa upfront): se intern tem 5 feitos + 6 futuros + 1 absent = 11, target 12 → falta 1, alarme dispara correto
- Funciona pra **UNIFACS** (alocação incremental): se intern não tem absences, alarme não dispara independente de futuros estarem alocados ou não. Só dispara se houver falta + saldo previsto < alvo
- Evita o `netDeficit` que depende do `expectedToNow` (sensível ao modelo de semana)

Output do passo: nenhum código novo. Lógica derivada no `<CockpitAlarms />` (Passo 3).

### Conceito de semana frágil — caveat e diferimento

A regra atual `expectedToNow = weeksElapsed * weeklyTarget`
(`compliance/.../get-compliance-overview.ts:150-155`) **assume alocação
evenly-paced**, o que não é verdade pra todas as faculdades:

- **ZARNS**: aloca toda a meta (6 USAs + 6 CRUs) no início da rotação.
  Soma feitos + agendados deve dar 12. Modelo evenly-paced funciona.
- **UNIFACS**: aloca incrementalmente, semana a semana. Um intern que
  fez a semana 1 mas ainda não foi alocado pra semana 2 vai aparecer
  como `status='deficit'` no compliance — **falso positivo**.

**Implicações**:
- O alarme 3 ("abaixo da meta semanal") usa `belowWeeklyTarget =
  lastWeekCompleted < weeklyTarget`. Pra ZARNS isso é robusto. Pra
  UNIFACS, se o intern não foi alocado pra `weeklyTarget` plantões na
  semana passada, ele aparece como abaixo da meta mesmo cumprindo o
  que foi escalado — **possível falso positivo**.
  - **Mitigação v1**: tooltip no card explicando a limitação, e teste
    explícito com sample de cada faculdade.
  - **Mitigação futura**: redefinir como "tem absences na última semana"
    (`lastWeekAbsent > 0`), que é à prova de modelo de alocação. Mas
    sobrepõe com alarme 2. Avaliar em branch separada.

- O alarme **"Não vai bater meta no tempo"** (que estava previsto como
  alarme 4) requer:
  - Expor `cohort.endDate` no compliance (JOIN novo via `user_roles.cohortId`)
  - Cálculo `(targetShifts - totalCompleted) > weeksRemaining * targetShiftsPerWeek`
  - Isso é mais profundo do que UI: mexe na repo do compliance e exige
    auditoria do modelo de cohort/rotation
  - **Decisão**: **diferido** pra branch nova `feat/cockpit-pace-alarm`
    depois desta. Não shippa nesta branch.

**Princípio**: cockpit não pode ter falso-positivo crônico. Alarme que
dispara errado vira ruído, coordenador desliga atenção, perdemos a
ferramenta. Antes ter 3 alarmes confiáveis do que 4 com ruído.

### Passo 2 — Compor o data fetch da página
Em `src/app/admin/page.tsx`, paralelo (`Promise.all`):
- `fetchDashboardData(...)` (atual, mantém)
- `executeGetComplianceOverview({ actor: { role: 'COORDINATOR', facultyId, id }, facultyId })`
  - `facultyId` lido de `searchParams.faculty` (string opcional)

A page extrai os 4 contadores derivados (regras do Passo 1) e monta
o objeto `cockpit` que passa pro `AdminDashboardClient`.

A "Sem check-in agora" pode ser derivada de `data.todayRoster` que
o dashboard atual já busca — verificar no Passo 2 se `todayRoster`
tem os campos suficientes ou se precisa enriquecer a query.

### Passo 3 — Componente `<CockpitAlarms />`
Novo arquivo: `src/components/admin/cockpit-alarms.tsx`

Props:
```ts
type CockpitAlarmsProps = {
  noCheckin: { count: number; items: AlarmItem[] };
  unreplacedAbsence: { count: number; items: AlarmItem[] };
  belowWeeklyTarget: { count: number; items: AlarmItem[]; caveat?: string };
};

type AlarmItem = {
  internId: string;
  internName: string;
  facultyAbbr: string;
  detail: string; // ex: "1 USA faltada, 0 reposições" ou "0/2 semana passada"
};
```

Comportamento:
- 3 cards numa linha em desktop, 1×3 em tablet/mobile
- Card colapsado: contagem grande + título + cor de status
- Card clicado: expande in-line (não modal) mostrando até 5 itens; "ver todos" leva pra `/admin/ver-interno?filter=...`
- Card "abaixo da meta semanal" tem ícone ⓘ que mostra tooltip:
  > "Considera meta fixa por faculdade. Em faculdades de alocação
  > incremental (ex: UNIFACS), pode incluir interno ainda não alocado
  > pra semana — verificar individualmente."
- Cor: vermelho pra `noCheckin` e `unreplacedAbsence` (urgência/perda de cumprimento). Amber pra `belowWeeklyTarget` (tendência).
- Estado vazio: o bloco inteiro vira uma faixa verde de 1 linha "Sem alarmes ativos — todos os internos estão no ritmo".

### Passo 4 — Integrar em `AdminDashboardClient`
- `<CockpitAlarms />` no topo, antes do header de KPIs atual
- Reduzir altura visual dos blocos abaixo (week days strip mais compacto, KPIs em 4-coluna ao invés de 2-coluna se cabível, modais inalterados)
- Header da página adquire breadcrumb "Cockpit" e timestamp ao vivo (atualiza a cada 60s via SSE ou polling — investigar o que já existe)

### Passo 5 — Sidebar
Em `src/app/admin/layout.tsx`:
- Mover `Bases` da slice "Operação" pra "Estrutura"
- Renomear "Dashboard" → "Cockpit" (label) — href segue `/admin`
- Manter ordem dos demais

### Passo 6 — Teste local
1. `pkill -f next; npm run dev`
2. Login como COORDINATOR (caio.olive94@gmail.com / admin123)
3. Navegar `/taximetro/admin` → confirmar:
   - 4 cards de alarme renderizam
   - Contagens batem com query manual no DB (ver "Validação" abaixo)
   - Click em card expande lista
   - Estado vazio: forçar via DB (zerar absences hoje) — ver faixa verde
   - Mobile (DevTools 390px): cards em 1 coluna, dashboard scrolla normal
4. Verificar nada quebrou em `/admin/ver-interno`, `/admin/presencas`, `/admin/faltas`
5. `npm test` passa

### Passo 7 — PR
- `gh pr create` com:
  - Título: "feat(admin): cockpit operacional com alarmes ativos"
  - Body: link pra este plano + screenshots desktop/mobile + checklist de teste

---

## Validação dos números (sanity check obrigatório no passo 6)

Antes de declarar pronto, abrir psql e validar contagem manual de cada alarme **separadamente para amostra de cada faculdade ativa** (mínimo: ZARNS + UNIFACS):

```sql
-- 1) Sem check-in agora (assignments hoje, intern não fez check-in)
SELECT COUNT(*) FROM assignments a
WHERE a.date = CURRENT_DATE
  AND a.status NOT IN ('CHECKED_IN','CHECKED_OUT','ABSENT','CANCELLED')
  AND a.is_extra_shift = false;
-- (ajustar pra janela de checkin já aberta — ver attendance-window-policy)

-- 2) Faltou sem reposição (faculty-agnostic):
--    interns com pelo menos 1 ABSENT no passado (não-extra) E
--    (completed_passados + futuros_não_extra) < target_shifts da faculdade
WITH intern_metrics AS (
  SELECT
    a.intern_id,
    f.target_shifts,
    SUM(CASE WHEN a.status = 'ABSENT' AND a.date <= CURRENT_DATE THEN 1 ELSE 0 END) AS absences,
    SUM(CASE WHEN a.status IN ('CONFIRMED','CHECKED_IN','CHECKED_OUT')
             AND a.date <= CURRENT_DATE THEN 1 ELSE 0 END) AS completed,
    SUM(CASE WHEN a.date > CURRENT_DATE AND a.status != 'CANCELLED' THEN 1 ELSE 0 END) AS future_count
  FROM assignments a
  JOIN user_roles ur ON ur.user_id = a.intern_id
  JOIN faculties f ON f.id = ur.faculty_id
  WHERE a.is_extra_shift = false
  GROUP BY a.intern_id, f.target_shifts
)
SELECT COUNT(*) FROM intern_metrics
WHERE absences > 0 AND (completed + future_count) < target_shifts;

-- 3) Abaixo da meta semanal — interns com lastWeekCompleted < weeklyTarget
--    Comparar com summary.belowWeeklyTarget do executeGetComplianceOverview
--    Validar separadamente por faculdade. Em UNIFACS, listar os internos
--    individualmente e confirmar com o usuário se cada um é alarme legítimo.
```

**Discrepância > 1 (depois de excluir corner cases conhecidos) → bug, não merge.**

**Sample test cases obrigatórios** (criar via seed-dev se não existirem):
- ZARNS intern com 1 absent + 0 reposição → alarme 2 dispara
- ZARNS intern com 1 absent + futures suficientes → alarme 2 NÃO dispara
- UNIFACS intern semana 1 ok, semana 2 não alocada ainda → alarme 2 NÃO dispara, alarme 3 talvez dispare (validar e ajustar tooltip)
- Intern ok (no ritmo) → nenhum alarme

---

## Decisões resolvidas

1. **"Reposição alocada" — modelo de dados (RESOLVIDO).**
   Não há linkage 1:1 falta↔reposição no schema, e pela regra de
   negócio confirmada com Caio não precisa: o que importa é o **saldo
   agregado** da rotação. `executeGetComplianceOverview` já modela
   isso via `compensating = rawDeficit > 0 && futureScheduled > 0 &&
   netDeficit === 0` (`compliance/.../get-compliance-overview.ts:159`).
   **Extras NÃO contam** como reposição (extras = bônus de oportunidade,
   não fazem checkin). Como `executeGetComplianceOverview` opera sobre
   `assignments` (não extras), a contabilidade já está correta.

2. **Faculty filter no cockpit (RESOLVIDO).** Dropdown com **"Todas"
   como default**. Filtro é facultativo (ajuda a reduzir poluição
   quando coordenador quer foco). Persistência: query string
   `?faculty=ID` pra ser shareable e bookmarkable.

3. **Real-time update (RESOLVIDO).** **Refresh simples**:
   `router.refresh()` automático a cada 60s + botão "atualizar agora"
   visível no header. Sem SSE.

4. **Substituir vs adicionar (RESOLVIDO).** **Substituir** o `/admin`
   atual. Os widgets atuais (roster, per-base, week strip) ficam
   abaixo do bloco de alarmes. Não criamos `/admin/cockpit`.

---

## Estimativa de esforço
- **S-M** (2-4h focado). Open question principal foi resolvida sem
  código novo — toda lógica vem de `executeGetComplianceOverview`.

## Riscos
- **Risco baixo**: tela atual continua acessível embaixo dos alarmes.
- **Risco baixo de regressão**: não muda lógica de scheduling/checkin,
  só read-side de admin.
- **Risco residual**: filtro por faculdade nunca foi exercitado pra
  COORDINATOR (no compliance overview, COORDINATOR sem `internId`
  vê todos — confirmar se passar `facultyId` filtra corretamente
  no caminho atual ou se precisa pequeno ajuste).

## Rollback
`git revert <merge-sha>` (merge commit, não squash). UX-PRINCIPLES.md
e este plano ficam no histórico mas removidos do tip — re-aplicáveis
em re-attempt.

---

## Definition of done

- [x] Open question 1 resolvida (sem necessidade de código novo)
- [x] Caveat de "conceito de semana frágil" documentado e mitigado
- [ ] `<CockpitAlarms />` renderiza 3 cards com contagens corretas
- [ ] Tooltip ⓘ no alarme 3 explicando caveat por faculdade
- [ ] Filtro de faculdade funcional (default "Todas", query string)
- [ ] Auto-refresh 60s + botão "atualizar agora"
- [ ] Validação SQL manual bate com UI em ≥4 cenários:
  - ZARNS intern com absence sem reposição
  - ZARNS intern com absence compensada por futuros
  - UNIFACS intern semana atual sem alocação completa
  - Intern sem absences no ritmo correto
- [ ] Sidebar reorganizada (Bases → Estrutura, label "Cockpit")
- [ ] Mobile: layout 1×3 funcional sem scroll horizontal
- [ ] `npm test` passa
- [ ] PR aberta com link pra este plano + screenshots
- [ ] Issue criada (não mergeada) pra branch follow-up `feat/cockpit-pace-alarm`
