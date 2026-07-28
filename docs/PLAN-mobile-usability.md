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
| `/admin/*` (inspeção de código) | Mesmos padrões: KPI grid `lg:grid-cols-4` vira 1-col gigante no mobile; `<table>` em `bases`, `audit`, `presencas`, `ver-interno` e `relatorios` **sem wrapper `overflow-x-auto`** (o padrão correto já existe em `admin/usuarios`) | grep em `src/app/admin` |

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

- **Fase 1 — mecânica, baixo risco** (1 PR): wrappers `overflow-x-auto` em todas as
  tabelas sem ele (leader/relatorios, admin/bases, admin/audit, admin/presencas,
  admin/ver-interno); KPI tiles compactos em `/leader/relatorios` e `/admin`;
  navegação de semana em 1 linha na escala.
- **Fase 2 — escala mobile-first** (1 PR): filtros colapsáveis + sticky first column
  na Planilha Única; avaliar visão por dia.
- **Fase 3 — admin gestão** (1 PR, se prioridade confirmar): telas de tabela densa
  (presencas, usuarios) ganham variante em cards no mobile.

## Open questions (pro Caio)

1. Grade da escala: sticky+scroll horizontal resolve, ou você quer a visão "por dia"
   (accordion Seg-Dom) já na primeira iteração?
2. Relatórios: os 5 KPIs podem virar uma linha de tiles compactos 2×3, ou algum deles
   merece destaque grande (ex.: Taxa de Presença)?
3. Admin no celular: qual frequência real de uso? Vale a Fase 3 ou admin pode
   continuar desktop-first por ora?
4. Alguma tela pode ser explicitamente desktop-only (ex.: `/leader/calibrar`)?
