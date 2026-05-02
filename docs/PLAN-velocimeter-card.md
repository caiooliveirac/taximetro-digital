# Plano — `feat/ux-velocimeter-card`

Branch: `feat/ux-velocimeter-card` (a criar)
Posição na fila: #2, depois das séries #1.x do cockpit.
Documentação base: [UX-PRINCIPLES.md](./UX-PRINCIPLES.md), [PROMPTUX.md](./PROMPTUX.md)

---

## Status no momento desta escrita

Já em prod (commits em master):
- #1   `feat/ux-admin-cockpit` — `87e8504f`
- #1.5 `feat/ux-cockpit-meta-detail` — `4bb4b979`
- #1.6 `fix/cockpit-weekly-meta-and-shift-filter` — `d820e13f`
- #1.7 `fix/cockpit-meta-this-week-trigger` — `5c78e827`

Estado dos alarmes do cockpit:
- **Sem check-in agora**: filtra por turno operacional (atual + anterior)
- **Faltou sem reposição**: agregado por saldo da rotação (extras não contam)
- **Abaixo da meta semanal**: trigger `thisWeek[T]Planned < target[T]PerWeek`, USA + CRU apenas (CRL fora por decisão de produto)

---

## Objetivo

Indicador visual reutilizável que responde em ≤2s a pergunta:
> "Este intern está no ritmo da rotação ou vai não bater meta no tempo?"

Velocímetro semafórico mostrando:
- **Cumprido / meta** — onde estamos no total
- **Ritmo atual** vs **ritmo necessário** — se o passo mantém ou acelera
- **Status** — verde / amber / vermelho

É a peça que materializa a fala original do Caio:
> "perceber cedo que está atrasado fará diferença crucial"

---

## Onde ele aparece

### A. `<InternQuickModal />` (já existe)
- Variant `card` no topo do modal, antes dos KPIs atuais.
- Substitui ou complementa o badge "no ritmo / compensando / parcial / déficit".

### B. `admin/ver-interno/page.tsx` (já existe)
- Variant `card` no header da view do intern selecionado.
- Variant `compact` em cada item da listagem (quando intern não está selecionado).

### C. `leader/internos/page.tsx` (já existe)
- Variant `compact` ou `inline` em cada linha da lista.
- Permite ao líder ver de relance qual interno precisa atenção.

### D. (avaliar durante) Linha do alarme no cockpit
- Talvez seja overkill — densidade já alta. Decidir após D.A./D.B./D.C. estarem prontos.

---

## Modelagem dos dados

### Necessário por intern
- `targetShifts` — meta total na rotação ✅ já em compliance
- `totalCompleted` — cumpridos até hoje ✅ já em compliance
- `rotationStartDate` — início da rotação ✅ já em compliance
- `rotationEndDate` — fim da rotação ❌ **PRECISA expor**

### Onde está `rotationEndDate`

Em `cohorts.endDate` (schema em `src/db/schema.ts:340`), linkado via `user_roles.cohortId` (nullable).

Caminho:
```
user_roles.cohortId → cohorts.endDate
```

### Como expor

**Passo 1**: extender `listActiveComplianceSubjects` em `src/features/compliance/infra/repositories/compliance-repository.ts`:
- LEFT JOIN cohorts ON cohorts.id = user_roles.cohort_id
- Selecionar `cohorts.endDate AS rotationEndDate`
- Tipo: `string | null` (intern sem cohort vinculado)

**Passo 2**: adicionar `rotationEndDate` ao return de `executeGetComplianceOverview` por intern.

Sem migration — campo já existe no schema.

---

## Cálculos

```ts
// Bordas seguras
const weeksElapsed = Math.max(1, weeksBetween(rotationStart, today));
const weeksRemaining = Math.max(0, weeksBetween(today, rotationEnd));
const weeksTotal = weeksElapsed + weeksRemaining;

// Ritmos
const ritmoAtual = totalCompleted / weeksElapsed;          // plantões/semana feitos
const restante = Math.max(0, targetShifts - totalCompleted);
const ritmoNecessario = weeksRemaining > 0
  ? restante / weeksRemaining
  : (restante > 0 ? Infinity : 0);                         // se acabou o tempo, é Infinity ou 0

// Capacidade máxima (cap pra "vai dar tempo")
const weekCapacity = Math.max(targetShiftsPerWeek, 3);     // 3 = piso conservador
const cabe = weeksRemaining * weekCapacity >= restante;

// Semáforo
let status: "ok" | "atencao" | "critico";
if (totalCompleted >= targetShifts) status = "ok";
else if (!cabe) status = "critico";                        // não cabe mais nas semanas restantes
else if (ritmoNecessario > ritmoAtual * 1.2) status = "atencao";  // precisa acelerar
else status = "ok";
```

### Tradeoffs nos limites
- `* 1.2` no atencao: tolerância pra leve flutuação de ritmo.
- `Math.max(targetShiftsPerWeek, 3)` no cap: evita "crítico" quando intern teoricamente pode fazer 3+/sem.
- Ambos discutíveis — confirmar com Caio durante teste local.

---

## Componente

### API

Novo arquivo: `src/components/admin/velocimeter-card.tsx`

```ts
type VelocimeterData = {
  completed: number;
  target: number;
  weeksElapsed: number;
  weeksRemaining: number;
  weeklyTarget: number;
};

type Variant = "compact" | "inline" | "card";

<VelocimeterCard variant="card" data={...} />
```

### Variantes

**`compact`** (1 linha, max-width ~280px) — pra row de tabela:
```
[●●●●●○○○○○○○]  5/12  ·  ⓘ no ritmo
```

**`inline`** (bloco médio) — pra cards de listagem:
```
┌──────────────────────────────┐
│ 5/12 plantões      ✓ no ritmo│
│ [████████░░░░░░░░░] 42%      │
│ atual 1.0/sem · meta 1.2/sem │
└──────────────────────────────┘
```

**`card`** (bloco completo) — pra modal e ver-interno:
```
┌─────────────────────────────────────┐
│ Andamento da rotação    ✓ NO RITMO  │
│                                     │
│ Cumprido            5/12 (42%)      │
│ [██████████░░░░░░░░░░░░░░]          │
│                                     │
│ ┌──────────┬──────────┬──────────┐  │
│ │ ritmo    │ ritmo    │ semanas  │  │
│ │ atual    │ necess.  │ restantes│  │
│ │ 1.0/sem  │ 1.2/sem  │ 6        │  │
│ └──────────┴──────────┴──────────┘  │
└─────────────────────────────────────┘
```

### Cores (alinhar a UX-PRINCIPLES)
- ok      → emerald-500 / emerald-50
- atencao → amber-500 / amber-50
- critico → red-500 / red-50

### Tipografia
- Números: `tabular-nums`
- Hierarquia: completed/target em peso 600+, percentual em 400

---

## Edge cases

| Caso | Comportamento |
|---|---|
| Intern sem cohort (`rotationEndDate = null`) | Card mostra "Sem turma vinculada", esconde ritmos |
| `targetShifts = 0` | Não renderiza velocímetro |
| `weeksElapsed = 0` (rotação acabou de começar) | Mostra "Início da rotação", chip neutro |
| `weeksRemaining = 0` (rotação acabou) | Mostra resultado final (verde se 100%, vermelho se déficit) |
| `totalCompleted >= targetShifts` | 100%, verde com check, sem ritmo necessário |
| `Infinity` em ritmoNecessario | Fallback "Sem semanas restantes" |

---

## Implementação por passos

### Passo 0 — Branch + plano (este doc) ✅

### Passo 1 — Expor `rotationEndDate`
- Estender query em `compliance-repository.ts`
- Estender retorno em `get-compliance-overview.ts`
- Adicionar tipo no consumer (pode ser `string | null`)
- Validar com tsx que campo aparece

### Passo 2 — Componente `<VelocimeterCard />`
- 3 variants
- Props tipadas
- Storybook-like preview manual em uma rota /dev (opcional, descartar antes do PR)

### Passo 3 — Integração modal
- Adicionar variant `card` no topo de `<InternQuickModal />`
- Confirmar visual em mobile e desktop

### Passo 4 — Integração admin/ver-interno
- Header: variant `card` no header quando intern selecionado
- Listagem: variant `compact` em cada item

### Passo 5 — Integração leader/internos
- Variant `compact` ou `inline` em cada linha — decidir após ver layout
- Cuidar de regressão (página existente, ler antes de mexer)

### Passo 6 — Smoke local
- npm run build
- Login e navegação como COORDINATOR e LEADER
- Zero 5xx em /admin/ver-interno, /leader/internos, modal aberto

### Passo 7 — PR + deploy
- Mensagem padrão dos PRs anteriores
- Esperar CI verde
- Merge + observar prod

---

## Open questions

1. **Cap de capacidade semanal** — `Math.max(targetShiftsPerWeek, 3)`. O 3 é arbitrário. Caio pode ter melhor número.
2. **Threshold do amber** — `ritmoNecessario > ritmoAtual * 1.2`. Validar com Caio se 20% é a tolerância certa.
3. **Mudança de cohort no meio da rotação** — `user_roles.cohortId` aponta pra cohort atual. Se intern mudou, history não é trivial. v1 usa cohort atual; aceitar.
4. **Variant em row de tabela vs listagem com cards** — depende de como `leader/internos` está hoje. Decidir em Passo 5 lendo o código.
5. **CRL** — fora da contagem de meta semanal por decisão. Velocímetro é da rotação inteira (totalCompleted = todos os tipos somados, é o que `targetShifts` mede). CRL **conta** aqui? `targetShifts` em `faculties` provavelmente já inclui CRL. Confirmar empiricamente: `targetShifts === targetUSAsTotal + targetCRUsTotal + targetCRLsTotal`?

---

## Risco
- **Baixo-médio**. Modal e ver-interno têm margem. `leader/internos` é página existente — risco de regressão se eu não cuidar do layout.
- Sem migration. Sem mudança de schema.
- Rollback: `git revert <merge-sha>`.

## Esforço estimado
- **M (3-5h focado)**, principalmente em Passo 5 (leader/internos é a integração com mais variabilidade de layout).

## Definition of done
- [ ] `rotationEndDate` exposto em compliance overview
- [ ] `<VelocimeterCard />` com 3 variants funcionais
- [ ] Integrado em modal, ver-interno, leader/internos
- [ ] `npm run build` passa
- [ ] Smoke local: zero 5xx, visual coerente em desktop e mobile
- [ ] Validado com sample real: intern atrasado vê crítico, intern no ritmo vê verde
- [ ] PR aberta, CI verde, merge, deploy verificado
- [ ] Observação 24h em prod antes de iniciar #3

---

## Para a próxima sessão

Para continuar este trabalho noutro chat:

1. Leia este arquivo + [UX-PRINCIPLES.md](./UX-PRINCIPLES.md).
2. Confirme estado: `git log --oneline -10` deve incluir `5c78e827` ou mais novo. `git status` limpo.
3. `git checkout -b feat/ux-velocimeter-card`.
4. Comece pelo **Passo 1** (expor `rotationEndDate`). É de baixo risco e desbloqueia tudo.
5. Antes de codar, valide as open questions 1, 2, 5 com o Caio.

Ambiente local:
- Postgres na porta 5436 (não 5434 como CLAUDE.md dizia)
- Schema do dev pode ter drift — rodar `DATABASE_URL=postgresql://taximetro:taximetro_dev@localhost:5436/taximetro npx drizzle-kit push` se houver erro de coluna inexistente
- `npm run dev` na porta 3000
