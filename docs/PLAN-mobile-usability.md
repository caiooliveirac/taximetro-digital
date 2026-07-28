# PLAN — Usabilidade mobile (leader + admin)

> Status: **aguardando revisão do Caio** · Branch: `claude/samu-leader-tabs-bug-4398b1`
> Item #3 da fila de UX (`feat/ux-leader-escala-mobile`), ampliado para cobrir admin.

## Contexto

O app é usado majoritariamente em celular, mas as áreas **leader** e **admin** foram
desenhadas desktop-first. Disparador: o bug das abas do leader (leader tocava em
Check-in e caía na view de interno sem caminho de volta) — **já resolvido neste
branch** — e a observação do Caio de que KPIs abrem imensos, grades/escala cortam
sem scroll e não há o mínimo de boas práticas mobile.

## Já feito neste branch (fora deste plano)

- Toggle de contexto no header mobile: leader vê chip **"Interno"** no topo
  (vai para `/intern`), interno multi-role vê chip **"Líder"/"Admin"/"Preceptor"**
  (volta para a área de gestão). Aba **Check-in removida** da barra inferior do leader.
- Helper puro `pickReturnRole()` em `src/lib/role-access-policy.ts` + testes.

## Auditoria (dev local, viewport 375×812, usuária LEADER+INTERN)

| Tela | Problema observado | Evidência |
|------|-------------------|-----------|
| `/leader/escala` | Navegação de semana empilha em 2 linhas ("Anterior" / "Próxima" um embaixo do outro); botão SORTEAR desproporcional; bloco de filtros (2 buscas + 2 selects) consome ~1 tela inteira antes do conteúdo; grade semanal corta no "Seg" sem indicação de que dá pra rolar | screenshot na sessão de 2026-07-28 |
| `/leader/relatorios` | 5 KPI cards grandes (~1,5 tela até chegar no conteúdo); tabela "Por Interno" **cortada à direita sem `overflow-x`** (coluna "A..." truncada) | idem |
| `/leader` (dashboard) | KPIs 2-col aceitáveis; cards de Pendências com 4-6 badges que quebram em 3-4 linhas cada, lista fica quilométrica | idem |
| `/admin/*` (inspeção de código) | **Correção pós-auditoria:** as tabelas do admin usam o componente `ui/Table`, que já embute `overflow-auto` — rolam, mas sem indicação visual de que há mais conteúdo. KPI grids já são `grid-cols-2` no mobile; o problema pontual são grids de 5 cards com o 5º órfão (`presencas`, `leader/relatorios`) | grep em `src/app/admin` + `src/components/ui/table.tsx` |
| `/admin/*` (auditoria live, 2ª rodada) | **Causa raiz do "tudo imenso" no admin:** `<main>` do layout admin era flex child sem `min-w-0` — a grade de escalas (min-width ~2100px) esticava a página inteira para 2133px e TODAS as telas ficavam mais largas que o viewport (conteúdo cortado à direita, fontes desproporcionais). Corrigido com `min-w-0` + quebras de linha nos headers do cockpit e presenças. Varredura pós-fix: todas as rotas `/admin` fecham em 375px | scrollWidth medido rota a rota no browser |

## Princípios propostos (regras de implementação)

1. **Nenhuma tabela corta silenciosamente**: toda `<table>` vive dentro de
   `<div className="overflow-x-auto">` com `min-w` no conteúdo. Padrão já usado em
   `admin/usuarios/page.tsx` — replicar.
2. **KPI compacto no mobile**: stat tiles em grid 2-col com padding/fonte reduzidos
   (`p-3`, número `text-2xl`), nunca card full-width gigante em coluna única.
3. **Navegação de período em 1 linha**: `‹` + label da semana + `›` na mesma linha,
   chevrons com touch target ≥44px.
4. **Filtros colapsáveis em telas de grade**: no mobile, bloco de filtros vira
   disclosure ("Filtros (2)") fechado por padrão.
5. **Grade semanal mobile**: coluna "Base" sticky + scroll horizontal com sombra de
   borda indicando conteúdo cortado (fase 1); visão "por dia" como evolução (fase 2).
6. **Touch targets ≥44px** e nenhuma ação hover-only.

## Fases propostas

- **Fase 1 — mecânica, baixo risco** ✅ implementada em 2026-07-28 (escopo ajustado
  pós-correção da auditoria): navegação de semana em 1 linha + SORTEAR proporcional
  no mobile (escala); filtros da escala colapsáveis no mobile (fechados por padrão,
  com contador de filtros ativos); dica de scroll horizontal acima da grade
  (mobile-only); fix do 5º KPI órfão em `leader/relatorios` e `admin/presencas`
  (`col-span-2` no mobile). Sticky first column na grade **já existia**.
- **Fase 2 — grade/CRU do admin** ✅ implementada em 2026-07-28 (pedidos diretos do
  Caio + extras): coluna BASE estreita no mobile (64px, só o código; nome e pill a
  partir de sm); vagas idênticas do CRU/CRL colapsadas em 1 card com contador
  ("11 vagas" em vez de 11 botões "Vaga", idem "Reservado"); filtros da escala
  preenchida reorganizados em linhas com scroll próprio (semana+busca / bases /
  dias / faculdades+turno / status); grade abre auto-rolada até a coluna de hoje
  no mobile.
- **Fase 3 — backlog proposto** (aguardando priorização do Caio):
  1. Modais (alocação, detalhe de plantão) como bottom-sheet no mobile com scroll
     interno, em vez de modal centralizado.
  2. Bloco de filtros da grade colapsável ("Filtros (N)") como na escala do leader —
     os 2 cards de filtro ainda ocupam ~1/3 da primeira dobra.
  3. Cabeçalho de dias sticky no scroll vertical da grade.
  4. Affordance de scroll (sombra de borda) no componente `ui/Table`.
  5. Telas de tabela densa (presencas, usuarios) com variante em cards no mobile.
  6. Default mobile da grade em "hoje" (filtro de dia já ativo) em vez de semana toda.

## Open questions (pro Caio)

1. Grade da escala: sticky+scroll horizontal resolve, ou você quer a visão "por dia"
   (accordion Seg-Dom) já na primeira iteração?
2. Relatórios: os 5 KPIs podem virar uma linha de tiles compactos 2×3, ou algum deles
   merece destaque grande (ex.: Taxa de Presença)?
3. Admin no celular: qual frequência real de uso? Vale a Fase 3 ou admin pode
   continuar desktop-first por ora?
4. Alguma tela pode ser explicitamente desktop-only (ex.: `/leader/calibrar`)?
