# Plano — `feat/ux-cockpit-meta-detail`

Branch: `feat/ux-cockpit-meta-detail`
Insere-se entre #1 (cockpit base) e #2 (velocímetro) da fila.
Resolve fricções identificadas em uso real do cockpit em produção.

---

## Objetivo

1. **Agrupar por faculdade** (sem filtro) os cards "Abaixo da meta semanal" e "Faltou sem reposição" — facilita repassar bloco completo a cada líder.
2. **Detalhe per-type** (`USA 0/1 · CRU 1/1`) em vez de agregado opaco (`0/2`) — explicita qual meta ficou abaixo.
3. **Trigger per-type** para "Abaixo da meta semanal" — captura o caso "compensou um tipo, perdeu outro" que o agregado mascarava.

## Regras finais (aprovadas)

| | Decisão |
|---|---|
| Agrupamento | Sim, em cards 2 e 3. Card "Sem check-in agora" mantém ordem por base. |
| Per-type breakdown | Sim, mostrar todos os tipos configurados pela faculdade (`targetXPerWeek > 0`). Tipo abaixo em vermelho, tipo OK em slate. |
| Trigger | Per-type: dispara se qualquer `lastWeek[T]Completed < target[T]PerWeek` |
| Card "Faltou sem reposição" | Sem breakdown per-type (regra é agregada por design — saldo total da rotação) |
| Modal `<InternQuickModal />` | Recebe mesmo breakdown nas linhas "esta semana" e "semana passada" |

## Implementação

### Passo 1 — Estender `AlarmItem` com breakdown opcional

```ts
type WeekBreakdown = {
  type: "USA" | "CRU" | "CRL";
  completed: number;
  target: number;
  below: boolean;
};

type AlarmItem = {
  internId: string;
  internName: string;
  facultyAbbr: string;
  detail: string;          // fallback texto
  breakdown?: WeekBreakdown[];
};
```

### Passo 2 — `build-cockpit.ts`

- Trigger per-type: `i.lastWeekUSACompleted < i.targetUSAPerWeek || i.lastWeekCRUCompleted < i.targetCRUPerWeek || i.lastWeekCRLCompleted < i.targetCRLPerWeek` (com guards para `targetXPerWeek > 0`)
- Para cada item flagged, gerar `breakdown` com todos os tipos onde `targetXPerWeek > 0`.
- Ordenação: `(facultyAbbr, internName)` para que itens cheguem ao componente já agrupáveis.
- Itens de "Faltou sem reposição" também ordenados `(facultyAbbr, internName)`.

### Passo 3 — `cockpit-alarms.tsx`

- Adicionar prop `groupByFaculty?: boolean` no `<AlarmCard />`.
- Quando `expanded && groupByFaculty && !facultyFilter` E há ≥2 faculdades distintas: renderizar com headers de grupo.
- Headers: `<div>` pequeno com `{abbr} · {count}` e cor da faculdade (reusar `getFacultyStyle`).
- Lista plana mantida em todos os outros casos (filter ligado, único faculty, ou alarme 1).
- Renderização do detail: se `item.breakdown`, render badges per-type; senão fallback `item.detail`.

### Passo 4 — `intern-quick-modal.tsx`

- Substituir as duas linhas atuais ("Esta semana" e "Semana passada") por componente que renderiza per-type breakdown.
- Layout: `USA: x/y · CRU: x/y · CRL: x/y` com cor por estado.

## Validação local (obrigatória antes do commit)

1. **Build prod limpo**: `npm run build` deve passar (não repetir o erro de prerender de `useSearchParams`).
2. **Smoke test sem erros 500**: rodar dev, logar como COORDINATOR, abrir `/admin`, abrir DevTools Network. Esperado: zero requests retornando 500. Especial atenção a:
   - `/api/compliance` (usado pelo modal)
   - `/api/case-records?internId=...` (usado pelo modal)
   - `/api/admin/assignments/detailed` (rota separada que apresentou problema antes)
3. **Validação de dados**: tsx que gera o cockpit em isolamento e valida:
   - Itens com breakdown têm pelo menos 1 tipo `below: true`
   - Items sem `targetXPerWeek` configurado não viram tipo no breakdown
   - Trigger per-type captura novos casos vs. agregado (mostrar amostra)

## Risco

- **Baixo**. Mudanças de UI + uma regra de filtro semântica.
- **Trigger per-type pode aumentar contagens**. Aceitável: cada novo alarme é legítimo. UNIFACS false-positive permanece — mesma mitigação via tooltip.
- **Rollback**: `git revert <merge-sha>` da PR.

## DoD

- [ ] AlarmItem estendido com `breakdown`
- [ ] Trigger per-type implementado em build-cockpit
- [ ] Itens ordenados `(facultyAbbr, internName)` em alarms 2 e 3
- [ ] AlarmCard renderiza grupos por faculdade quando aplicável
- [ ] Modal mostra per-type
- [ ] `npm run build` passa
- [ ] Smoke local: zero 500 em `/admin`
- [ ] PR aberta + CI verde
