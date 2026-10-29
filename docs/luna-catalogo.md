# Dai (ex-Luna) do interno — arquitetura e catálogo de dados

Nome visível desde 2026-10-29: **Dai** (a Central do SAMU já tem a sua Luna).
Arquivos, rota `/intern/luna`, tipos e o log `luna_interno` mantêm o nome antigo.

Verificado em 2026-10-29 contra o banco de produção (role `leitor`, só
catálogo e SELECT) e contra o código em `master`.

Princípio: **PostgreSQL recupera, o domínio calcula e valida, o modelo
interpreta o pedido e escolhe a ferramenta.** A Luna só lê; toda ação passa
pela tela e pelo caso de uso oficial, que revalida.

## Arquitetura

```
pergunta ──► luna-roteador.ts ──(inequívoca)──► ferramenta ──► resposta pronta   0 chamadas ao modelo
                 │
                 └─(precisa interpretar)──► 1 chamada ao modelo
                        prompt = regras + RESUMO do interno + CALENDÁRIO + memória
                        ├─ responde direto (pergunta sobre o resumo)                1 chamada
                        └─ escolhe ferramenta + parâmetros ──► resposta pronta      1 chamada
```

| Camada | Arquivo | Papel |
|---|---|---|
| A — dados | `src/lib/luna-dados.ts` | `criarFontes(ctx)`: cada fonte lida no máximo 1× por pergunta (memo), escopada pelo interno da sessão, com tempo e contagem registrados |
| B — inteligência | `src/lib/luna-inteligencia.ts` | Puro, sem banco. Classifica cada oferta (`ELIGIBLE`, `REQUIRES_APPROVAL`, `INCOMPATIBLE`, `ALREADY_CLAIMED`, `INSUFFICIENT_DATA`) com motivo padronizado, ordena, monta o plano que fecha a meta, explica plantão e presença |
| C — conversa | `src/lib/luna-ferramentas.ts`, `luna-roteador.ts`, `luna-interno.ts` | Ferramentas por intenção que devolvem texto + cartões + memória; roteador do caminho direto; orquestração de 1 chamada |

Antes (#108): 5 ferramentas (`meu_resumo`, `vagas_liberadas`, `extras_abertos`,
`trocas_abertas`, `vagas_da_grade`) devolviam listas; o modelo cruzava e
redigia, em 2 chamadas no mínimo (até 4), e cada ferramenta relia meta e
agenda.

### Ferramentas

| Ferramenta | Substitui | O que faz no backend |
|---|---|---|
| `buscar_opcoes` | as 5 antigas | Lê só as fontes do objetivo (meta / plantão a mais / troca), aplica tipo, dia bloqueado, descanso de 12h, trava da vaga liberada, fim do rodízio; ordena e, para meta, escolhe a combinação sem choque entre si. Troca: confere o lado do colega (descanso, cota de CRU, pedido pendente) pelo caso de uso |
| `avaliar_troca` | — | Um par (meu plantão × oferta): mesmo tipo, descanso dos dois lados, cota de CRU, faculdade, pedido pendente |
| `explicar_plantao` | — | "Por que não contou": extra, falta (com/sem justificativa), checkout vencido, antes/depois do rodízio, cancelado — pela mesma regra das casinhas |

Caminho direto (sem modelo): meta, agenda (hoje/amanhã/próximos), presença,
"consigo fechar a meta?", vaga liberada, extra, grade, trocas. Os 6 atalhos da
tela caem todos aqui.

Ordenação (`ordenar`): sem aprovação antes de com aprovação → conta para a
meta → turno preferido → dia preferido → data mais próxima.

### Memória

- **Estrutural**: este documento e o código. Nada disso vai ao modelo além das
  regras curtas do prompt.
- **Operacional**: `RESUMO` montado do banco a cada pergunta (meta, rodízio,
  10 próximos plantões, nº de pendências). Nunca reconstruído do histórico.
- **Conversacional**: cada resposta devolve `memoria = { busca, opcoes:
  [{n, fonte, id}] }`; a tela guarda e reenvia. "A segunda" vira `opcoes:[2]`,
  e o id é **revalidado** contra a lista atual do próprio interno — opção que
  sumiu vira "não está mais aberta"; id forjado não acha nada.

### Confiabilidade

Falha de consulta responde "não consegui consultar — não vou chutar"
(`erro: true`), nunca "não há vagas". Sem meta: `INSUFFICIENT_DATA`. O modelo
não passa id de interno: `sanearArgs` descarta todo campo desconhecido, e o
`internId` vem da sessão (`getEffectiveUser`). Lista de trocas não mostra a
agenda do colega; só a avaliação de um par diz o motivo (o mesmo texto da tela
de Trocas).

Log `ev: "luna_interno"`: `rota` (`direta` | `modelo` | `modelo+ferramenta`),
`intencao`, `chamadas_modelo`, `entrada`/`saida` (tokens), `ferramentas`
(nome, ms, status, registros), `fontes` (fonte lógica, ms, linhas, ok),
`args` da ferramenta, `erro`.

## Catálogo do banco (produção, 2026-10-29)

Inventário: 23 tabelas, **0 views**, **1 materialized view**, **1 função**,
**0 triggers** no schema `public`. A inteligência mora no código de domínio,
não no banco.

| Objeto | Tipo | Granularidade | Quem usa | Fonte da verdade para a Luna? |
|---|---|---|---|---|
| `assignments` (~14,5 mil) | tabela | 1 plantão por interno/data/turno/meio turno | todo o app | Sim — agenda (`luna-dados.meusPlantoes`) |
| `checkins` (~9 mil) | tabela | 1 por plantão (`assignment_id` único) | presença, preceptor | Sim — checkout/check-in |
| `extra_shift_offers` (354) | tabela | 1 vaga por base/data/turno; `released_faculty_id`/`auto_release` separam vaga liberada de extra | extras, grade do líder | Sim, via `listFreeOffers` / `listExtraOffers` |
| `requests` (~1,9 mil) | tabela | pedido de troca/extra/vaga livre | Trocas | Sim, via `executeListRequests(open-swaps)` |
| `slot_rules` (312) | tabela | regra semanal base×dia×turno×faculdade | grade | Indireto, via `getRequestableSlots` (10 dias, até o fim do rodízio da turma) |
| `cohorts`, `user_roles` | tabelas | rodízio e vínculo | compliance | Indireto, via `executeGetComplianceOverview` |
| `cru_fixed_assignments` | tabela | CRU fixo com vigência | cota de CRU | Indireto, via `findInternOverCruQuota` |
| `available_slots` (273 linhas) | **matview** | regra semanal; `filled` conta plantões de **todas as datas da história** daquele dia da semana | **ninguém** (só `scripts/materialized-view-available-slots.sql`) | **Não.** Não responde "vaga livre na data X"; `available` vira negativo; sem refresh agendado |
| `refresh_available_slots()` | função (volátil) | — | ninguém | Não executada (efeito colateral) |

Índices relevantes: `assignments(date)`, `assignments(intern_id)`,
`extra_shift_offers(released_faculty_id, date)`, `(date)`, `(claimed_by)`,
`slot_rules` único por base×dia×turno×faculdade. `requests` só tem a PK.

### Serviços reaproveitados (nenhuma regra duplicada)

| Regra | Fonte única |
|---|---|
| Casinhas da meta, faltam por tipo | `executeGetComplianceOverview` + `goal-slots.ts` |
| Descanso de 12h, meio turno | `rest-policy.ts` (`plantaoSemDescanso`) |
| Pendência de presença | `pending-attendance.ts` (`classifyPendingAttendance`) + prazo de `utils.hasCheckoutDeadlinePassed` |
| Troca entre faculdades só USA | `cross-faculty-swap-policy.ts` (já aplicado em `executeListRequests`) |
| Cota de CRU, descanso do colega | `findInternOverCruQuota`, `findSwapRestConflict` (exportados de `handle-swap-peer-action.ts`) |
| Vaga liberada só abaixo da meta | mesma trava de `claim-extra-offer.ts`, aplicada em `avaliarOferta` |

## Antes × depois (mesmas perguntas)

| | Antes (#108, logs do LIVE) | Depois |
|---|---|---|
| Atalhos e perguntas inequívocas | 2 chamadas, 1,7–2,7 mil tokens, 3–5,7 s | **0 chamadas, 0 tokens**, 0,4–1,5 s (banco) |
| Pergunta com restrições | ≥ 2 chamadas (até 4), modelo cruza listas | **1 chamada** ≈ 1,7 mil tokens de entrada; backend cruza |
| Leituras de meta/agenda por pergunta | 1 por ferramenta chamada (2–5×) | 1× cada (memo) |
| Quem calcula descanso, meta, elegibilidade | backend parcial + modelo | backend inteiro |

Os números do "depois" com modelo são estimativa por tamanho do corpo
(chars/3,6); o log `luna_interno` em produção mede os reais.

## Decidido em 2026-10-29 (depois do #111)

- **Descanso de 12h em todo caminho**: pegar extra, escalar em vaga livre
  (`claim-extra-offer.ts`) e aprovar extra da grade (`review-request.ts`)
  passam por `semDescansoPara` (`src/features/scheduling/application/descanso.ts`).
  Só a escala retroativa da coordenação fica de fora. A sobra da grade já sai
  filtrada (`getRequestableSlots`).
- **Sobra da grade**: 10 dias, cortada no fim do rodízio da turma do interno.
- **Pedidos no SQL**: `listRequestsRows(filtro)` recorta por trocas abertas,
  pessoa ou faculdade; só a visão "tudo" da coordenação lê a tabela inteira.
  Conferido igual à lógica antiga em 6 escopos com dado real.
- **Vaga liberada é de quem precisa de reposição**: com a meta completa nos
  tipos pedidos, a Dai nem busca vaga liberada e diz quantos colegas precisam
  (agregado `Fontes.demanda`, cache de 10 min, só contagem).

Medido em 2026-10-29: 131 internos precisam de 611 casinhas de USA, 112 de
356 de CRU, 60 de 60 de CRL — a demanda passa da oferta em todo tipo.

## Pontos em aberto

1. **Candidatura a vaga livre pelo interno** (proposta, não feita): hoje só o
   líder pede `FREE_SLOT` para interno acima da meta. Ideia: o interno se
   candidata pela Dai; abaixo da meta vai ao líder, acima vai à coordenação, e
   só abre para quem está acima quando a oferta do tipo na janela passar de
   quem precisa de reposição e cabe na data.
2. **`available_slots`**: matview morta e enganosa. Substituir por "turno
   livre por data" exige DDL e mover o teto físico das
   bases, hoje em `capacidadeDaBase` (código), para o banco.
3. `requests` só tem a PK; com o recorte no SQL ainda não faz falta índice.
