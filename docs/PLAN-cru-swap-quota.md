# PLAN — cota de troca de CRU por rodízio

Substitui a autorização do preceptor por uma regra que o sistema consegue
verificar sozinho: **cada interno troca o dia de CRU dele uma vez por rodízio**.

## Por que trocar a regra

A autorização do preceptor não fazia análise de mérito — o preceptor aprovava
tudo. Pior: ele não tinha como perceber que o mesmo interno estava trocando pela
segunda vez no mesmo rodízio, porque a tela mostra uma troca por vez. Trabalho
humano que não decidia nada e ainda deixava passar o caso que importava.

## Regra

Uma troca de CRU (`base.type === "CENTRAL"`) é recusada na confirmação se
**qualquer um dos dois internos** já concluiu outra troca de CRU dentro da
vigência do rodízio dele. Fora isso, a troca se efetiva na hora — igual CRL e
USA.

Rodízio de um interno = vigência do CRU fixo dele: `[valid_from, valid_until]`
em `cru_fixed_assignments`. Repetente que entra em turma nova recebe um CRU fixo
novo, com `valid_from` novo — a cota zera junto, mesmo que a turma nova comece
antes de fechar 6 semanas.

Interno sem CRU fixo ativo (troca de CRU avulsa) cai no fallback: 6 semanas
corridas a partir da última troca de CRU concluída.

## Peças

| Onde | O quê |
|---|---|
| `drizzle/0023_cru_fixed_valid_from.sql` | coluna `valid_from`, backfill `valid_until - 41 dias` |
| `src/db/schema.ts` | `validFrom` no `cruFixedAssignments` |
| `add-cru-fixed.ts` | grava `valid_from = weekStart` ao criar/renovar |
| `cru-swap-quota.ts` (policy pura) | decide bloqueio a partir de janela + trocas concluídas |
| `request-repository.ts` | janela ativa do interno + contagem de trocas CRU concluídas |
| `handle-swap-peer-action.ts` | checa cota no `propose` e no `confirm`; CRU deixa de virar `AWAITING_AUTH` |
| `src/app/intern/trocas/page.tsx` | aviso passa a explicar a cota, não o preceptor |
| tela do preceptor + `authorize-swap.ts` | removidos |
| `scripts/complete-awaiting-auth-swaps.mjs` | efetiva as trocas que ficaram paradas em `AWAITING_AUTH` |

## Decisões tomadas (usuário, 2026-07-30)

- janela vem do CRU fixo, com coluna nova — não 6 semanas corridas
- os dois internos gastam cota; senão quem quer trocar muito só espera ofertas
- `AWAITING_AUTH` pendente em produção é concluído automaticamente pelo script

## Riscos

- O backfill de `valid_from` chuta 6 semanas para trás nas linhas existentes. Se
  algum rodízio antigo tinha outra duração, a cota do rodízio corrente pode
  contar uma troca a mais ou a menos. Some sozinho na próxima renovação.
- O script de conclusão mexe em escala publicada sem revisão humana: rodar com o
  relatório de contagem na frente e backup do dia confirmado.
