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
`args` da ferramenta, `erro`. Some a cada deploy (log do container).

Para estudar o uso, cada pergunta de interno não personificado vira
`DAI_PERGUNTA` no `audit_log` (`src/lib/dai-perguntas.ts`): pergunta, resposta
(até 2000 chars), rota, intenção, ferramentas, `args`, ms. Guarda 90 dias.

## Catálogo do banco (produção, 2026-10-29)

Inventário em 29/10 (manhã): 23 tabelas, 0 views, 1 materialized view, 1
função e **2 triggers** no schema `public`. A inteligência mora no código de
domínio, não no banco.

> Correção: a primeira versão deste catálogo dizia "0 triggers" — a consulta
> foi pelo `information_schema`, que esconde trigger de quem só lê. Pelo
> `pg_trigger`, `trg_refresh_slots` (em `assignments`) e
> `trg_refresh_slots_rules` (em `slot_rules`) faziam `REFRESH` da matview
> (~0,6 s) dentro de toda escrita. Removidos em 29/10 — ver abaixo.

| Objeto | Tipo | Granularidade | Quem usa | Fonte da verdade para a Luna? |
|---|---|---|---|---|
| `assignments` (~14,5 mil) | tabela | 1 plantão por interno/data/turno/meio turno | todo o app | Sim — agenda (`luna-dados.meusPlantoes`) |
| `checkins` (~9 mil) | tabela | 1 por plantão (`assignment_id` único) | presença, preceptor | Sim — checkout/check-in |
| `extra_shift_offers` (354) | tabela | 1 vaga por base/data/turno; `released_faculty_id`/`auto_release` separam vaga liberada de extra | extras, grade do líder | Sim, via `listFreeOffers` / `listExtraOffers` |
| `requests` (~1,9 mil) | tabela | pedido de troca/extra/vaga livre | Trocas | Sim, via `executeListRequests(open-swaps)` |
| `slot_rules` (312) | tabela | regra semanal base×dia×turno×faculdade | grade | Indireto, via `getRequestableSlots` (10 dias, até o fim do rodízio da turma) |
| `cohorts`, `user_roles` | tabelas | rodízio e vínculo | compliance | Indireto, via `executeGetComplianceOverview` |
| `cru_fixed_assignments` | tabela | CRU fixo com vigência | cota de CRU | Indireto, via `findInternOverCruQuota` |
| ~~`available_slots`~~ | matview | regra semanal; contava plantões de toda a história | ninguém | **Removida em 29/10** (SAMU), com a função e os triggers |
| `turnos_livres` | **view** (desde 29/10) | data × base × turno × faculdade dona, 45 dias: capacidade, ocupadas, liberadas abertas/usadas, reservadas, sem dono, **sobra** | `fila-de-reposicao.ts` (oferta de vaga livre) | Sim, para "turno livre por data". Só fatos, sem política; ~12 ms. `scripts/view-turnos-livres.sql` |

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

### Avaliação com o modelo real (29/10, `gpt-6-luna`, dado real só leitura)

18 perguntas (as 12 do pedido, seguimentos e fora do tema), interno real com
USA no sábado e meta completa:

| | Antes (#108, log do LIVE) | Depois (medido) |
|---|---|---|
| Diretas (meta, amanhã, descanso, checkout, "fecham minha meta") | 2 chamadas | 0 chamadas, 1–2.000 ms (banco) |
| Com modelo | 2–4 chamadas, 1,7–2,7 mil tokens, 3–5,7 s | 1 chamada, 1,65–2,0 mil tokens de entrada, 17–61 de saída, 1,4–5 s |

Erros de tradução achados na 1ª rodada e corrigidos no prompt/ferramentas:
"já tenho plantão sexta" virava bloqueio da sexta; "fim de semana" não
virava preferência; "dessas" sem lista inventava número; pergunta de regra
("fecha com uma falta?") ia para ferramenta. Defeitos do backend achados:
troca no mesmo turno do plantão do interno, turno já começado na sobra da
grade, reavaliação renumerando a lista ("a primeira" mudava de sentido),
texto de meta completa e de fila longos demais. Todos com teste de regressão
em `tests/luna-avaliacao.test.ts`. Na 2ª rodada, as traduções saíram certas.

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

## Candidatura a vaga livre (29/10)

O interno de meta completa no tipo se candidata a uma vaga liberada ou sem
dono (`POST /api/intern/vagas-livres/candidatura`, botão "Me candidatar" na
Dai). Vira o mesmo pedido `FREE_SLOT` que o líder já abria; a coordenação
aprova em Admin → Solicitações. Regras (`candidatar-vaga-livre.ts`):
12h de descanso; quem ainda precisa do tipo não se candidata (o líder escala
direto); e só abre quando as vagas livres abertas nos próximos 10 dias passam
de quantos internos precisam de reposição naquele tipo
(`fila-de-reposicao.ts`, cache de 10 min). Fechada, a Dai nem busca vaga
liberada e diz o tamanho da fila.

A Dai não fala de meta: está na tela Início. "Quanto falta?" responde com um
ponteiro, sem consulta e sem modelo; o prompt não leva números de meta.

## Avisos da Dai no chat (29/10)

Texto pronto, sem modelo (`src/features/dai-avisos/`), por cron do container
(`scripts/container-entrypoint.sh`, desliga com `DAI_AVISOS_ENABLED=false`).
A Dai é um usuário sem login (`dai@assistente.taximetro`, inativo); no chat a
conversa com ela não tem campo de resposta e aponta para a aba Dai.

| Aviso | Quando | Para quem | O quê |
|---|---|---|---|
| `plantao` | 17h | quem tem plantão amanhã (1 por interno) | base, "veja na aba Bases", tema para revisar (primeiro do tipo que ele não abriu na Dai) |
| `vagas` | :25, 8h–20h | todos que ainda precisam do tipo, vaga de amanhã a 10 dias, no rodízio dele, com 12h de descanso, que cabe na viatura | até 3 vagas; 1 mensagem por dia; os mais urgentes escolhem primeiro e cada um recebe as menos citadas |
| `lideres` | 8h | líder ativo, 1 por dia | turnos da grade sem escala nos 7 dias (só em dia de turma), internos com casinha vazia, vagas de outras faculdades |

Cada envio vai para o `audit_log` (`DAI_AVISO_PLANTAO|VAGAS|SOBRA`), que é o
que impede repetir. `GET /api/cron/dai-avisos?tipo=…&dry=1` monta sem enviar.
Simulação em 29/10 com dado real: 48 (plantão), 131 (vagas), 11 (líderes).

Teto da viatura (`lotacao.ts`, regra em `capacidadeDaBase`): vaga livre ou
extra de USA só é oferecida — no aviso e na Dai — se a base ainda tem lugar no
turno contando os plantões de todas as faculdades. Em 29/10, 2 das 39 vagas
USA abertas já estavam com a viatura cheia.

## Pontos em aberto

1. **Vitalmed** ainda tem a matview antiga com triggers: o banco dela não tem
   `extra_shift_offers.reserved_by` (push atrasado, deploy manual). A view só
   entra depois do push dela.
2. O teto físico das bases segue em `capacidadeDaBase` (código). A view não
   precisa dele (só fatos da grade); se um dia o "sem dono" for calculado no
   banco, ele muda para `bases`.
3. `requests` só tem a PK; com o recorte no SQL ainda não faz falta índice.
