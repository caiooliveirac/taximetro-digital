# PLAN — experiência do interno: achar plantão sem depender de ninguém

Objetivo: o interno que precisa trocar um plantão, ou fechar a meta, resolve
pelo app: vê o que existe, conversa com quem pode trocar e sabe o próximo passo.

## Fase 1 — no ar (este PR)

| Peça | O que faz | Onde |
|---|---|---|
| Mapa das bases | Aba Bases vira mapa de Salvador (Leaflet + CARTO). Bases no mesmo endereço viram um ponto só (BR05/BR60, PM04/PM40/CRU). "Onde estou" pega a localização, ordena por distância e manda rota para Maps/Uber saindo dali (Waze usa a do celular). Próximo plantão com anel âmbar. `?base=CB02` abre direto numa base. | `src/components/intern/bases-map.tsx` |
| Mensagens | Conversa direta entre internos/líderes de **qualquer** faculdade. Botão Conversar nas ofertas de troca e nas propostas. Ícone com contador no cabeçalho. Personificando: lê, não escreve, não marca como lida. | `api/intern/mensagens`, `intern/mensagens`, tabela `intern_messages` |
| Luna (`gpt-6-luna`) | Botão flutuante em todas as telas do interno. Seis atalhos de pergunta. Ferramentas só de leitura: meta, vagas liberadas, extras, ofertas de troca, vagas da grade. Os cartões (com Conversar, Pedir ao líder, ver no mapa) saem do resultado das ferramentas, não do texto do modelo. Teto: 40 perguntas/pessoa/dia, uma por vez. | `src/lib/luna-*.ts`, `api/intern/luna`, `intern/luna` |

**Vaga liberada na Luna** segue a trava de hoje: só aparece para quem ainda tem
casinha vazia na meta daquele tipo, sem quebrar 12h de descanso. Quem escala
continua sendo o líder: o cartão "Pedir ao líder" abre a conversa com ele já
escrita.

## Fase 2 — proposta, falta confirmar

Dados de produção (2026-10-29):

- Trocas USA em 60 dias: 177 concluídas, **302 canceladas**, 67 abertas. Quase
  2 de cada 3 ofertas morrem sem par. Só a ZARNS tem oferta aberta hoje.
- Vagas liberadas USA abertas no futuro: **229** (213 sem dono, 16 manuais).
  Usadas nos últimos 30 dias: 32.

### 2a. Troca com interno de outra faculdade (só USA)

Hoje o bloqueio é um `if` (`handle-swap-peer-action.ts:129`) e a lista de
ofertas filtra pela faculdade (`list-requests.ts:47`). Tirar os dois não basta:
a grade conta vaga **por faculdade** pelo `assignments.facultyId`
(`slots.ts:checkSlotAvailability`, `auto-release-slots.ts`, `grade-do-turno.ts`).
Se a interna da UNIFACS assume o plantão da EBMSP mantendo `facultyId` UNIFACS,
a grade da EBMSP mostra a vaga vazia, o líder escala outro e o cron de vaga
livre a libera de novo.

Proposta: usar o mecanismo que já existe para vaga liberada usada por outra
faculdade. Na confirmação de uma troca entre faculdades, na mesma transação:

```
para cada lado (plantão P de A que vai para B):
  novo plantão de B: facultyId = faculdade de B, isExtraShift = false
  extra_shift_offers += { base/data/turno de P, releasedFacultyId = faculdade de A,
                          claimedBy = B, assignmentId = novo plantão,
                          autoRelease = "TROCA" }
```

Assim a vaga continua sendo da faculdade dona na grade, o cron já ignora
plantão vindo de vaga liberada (`deVagaLivre`, `auto-release-slots.ts:215`) e a
meta de cada interno conta normal. `autoRelease = "TROCA"` separa do painel de
uso de vaga livre do admin.

| Cenário | Resultado |
|---|---|
| USA ↔ USA, faculdades diferentes, descanso ok | troca efetivada; duas ofertas `TROCA` registradas |
| CRU ou CRL entre faculdades | bloqueado (grade de CRU é por faculdade, meio turno do EBMSP) |
| Mesma faculdade | igual a hoje, sem oferta `TROCA` |
| Coordenação cancela um dos plantões depois | a oferta `TROCA` fica; precisa decidir (pergunta 3) |

### 2b. Trocar meu plantão por uma vaga vazia

"Tenho USA sábado, queria a vaga liberada de terça": numa ação só, devolve o
plantão (volta para a grade da faculdade, o líder repõe ou o cron libera no
prazo) e assume a vaga, mesmo tipo. A meta não muda, então vale mesmo para quem
já fechou a meta.

### 2c. Interno pega vaga liberada sozinho

Hoje a API **já aceita** POST do interno numa vaga liberada sem checar a meta
(`claim-extra-offer.ts:151` só trava LEADER). Proposta: estender a trava ao
INTERN (abaixo da meta pega direto; acima, 409) e pôr o botão "Pegar" no cartão
da Luna e numa seção de Extras. Mesmo sem 2c, a brecha precisa fechar.

### Perguntas para o Caio

1. 2a só USA está bom, ou CRL também?
2. 2b: o plantão devolvido volta para a grade da faculdade (líder repõe) ou já
   vira vaga liberada na hora?
3. Troca entre faculdades desfeita pela coordenação: a vaga volta para quem?
4. 2c: o interno pega direto, ou continua pedindo ao líder? Se continuar,
   fecho só a brecha da API.
5. Mensagem nova avisar no Telegram do interno (quem tem vínculo)? Hoje só o
   contador no app.
