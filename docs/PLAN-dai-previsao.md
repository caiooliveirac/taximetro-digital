# PLAN — Dai prevê o turno: o que está em jogo e a que horas voltar

Estado: proposta, 2026-10-30. Nada implementado.

## O que as perguntas querem de verdade

Uso real das primeiras 16h (audit_log `DAI_PERGUNTA`, 61 perguntas):

| Pergunta real | O que a pessoa quer saber |
|---|---|
| "Dia 09/11 tem?", "Preciso pegar dia 29, 30 e 01" | Vou conseguir plantão **naquele dia**? |
| "Tem vaga liberada pra mim?" 13× entre 17h41 e 02h28 | **Quando** aparece algo? (ela está conferindo de tempos em tempos) |
| "Não posso dia 08" 4× | Lembra o que eu disse. |
| "Fiz solicitação há tempo e não analisaram" | Quando vou saber? |

O traço comum é **tempo**. Hoje a Dai responde uma foto do agora ("nada
encaixa agora") e a pessoa volta para perguntar de novo. A resposta que serve
diz **o que pode abrir, quando abre, se é para ela e com quanta disputa**.

## O que o sistema já sabe e não diz

A repescagem (`repescagem.ts`) é determinística. A vaga livre (liberada ou
sem dono) que segue aberta vira extra 8h antes do turno:

| Turno | Repescagem abre | Fecha |
|---|---|---|
| Diurno (07h) | 20h da véspera | 07h |
| Tarde EBMSP (13h) | 20h da véspera | 13h |
| Noturno (19h) | 11h do dia | 19h |

Quem pega na repescagem:
- tem casinha vazia no tipo: conta na meta;
- meta fechada e nunca teve extra: vira extra;
- já tem extra no histórico: **não pega**.

Valem sempre 12h de descanso e o lugar na viatura. Quem precisa do tipo, ou
marcou **Quero** no turno sem nunca ter tido extra, recebe aviso da Dai na
abertura (cron :15, das 8h às 20h).

Dá para prever, para cada turno, quantas vagas livres estão abertas agora e
podem cair na repescagem, a hora exata em que caem, e se aquela pessoa vai
poder pegar.

## Dados (produção, 30/10 manhã)

Vagas livres (liberadas e sem dono, sem reserva nem troca), por turno:

| Turno | Total | Pegas | Pegas nas últimas 12h | Desprezadas | Abertas |
|---|---|---|---|---|---|
| 29/10 noite | 9 | 5 | 1 | **3** | — |
| 30/10 dia | 2 | 0 | 0 | **1** | — |
| 30/10 noite | 8 | 3 | — | — | 4 |
| 02/11 dia | 12 | 0 | — | — | 11 |
| 09/11 dia / noite | 9 / 10 | 0 | — | — | 8 / 9 |

- **10 dias passados:** 8 vagas livres desprezadas.
- **29/10 noite:** a única noite que já teve repescagem com aviso (94 avisos, 17h15). Mesmo assim sobraram 3 das 9. Só 1 foi pega nas 12h finais.
- **Quando as vagas foram pegas:** das 21 pegas desde 27/10, 11 saíram com mais de um dia de antecedência, ainda pelo líder, e só 5 nas 8h finais.
- **Sobra da grade (`turnos_livres.sobra`):** turno de faculdade *em turma* que ninguém dela ocupou. **É o maior estoque desperdiçado:** só em 30/10 diurno, 17 lugares (10 CRU, 5 USA, 2 CRL) começaram sem ninguém, contra 1 vaga liberada desprezada. Nos próximos dias, de 9 a 55 lugares por dia seguem sem ninguém (o líder ainda pode escalar). Hoje essa sobra **não entra na repescagem**: só o líder da própria faculdade escala.

## Proposta

### 1. Resposta prevista (sem mudar regra nenhuma)

Pergunta por dia ou por vaga (atalhos e `datas`), quando não há nada que a
pessoa pegue agora, ganha um bloco **"O que ainda pode abrir"**, por turno
pedido ou pelos próximos 3 turnos:

```
para cada turno T na janela pedida:
  livres = vagas livres abertas em T que cabem no descanso e na agenda dela
  se livres = 0: "nada em jogo em T"
  abre = aberturaDaRepescagem(T)
  elegivel =
    faltam[tipo] > 0              → "pega direto e conta na meta"
    senão, nunca teve extra       → "pega direto como extra (um só)"
    senão                         → "a repescagem não é para você: já tem extra"
  disputa = colegas que receberão aviso de T (precisam do tipo + Quero sem extra) ÷ livres
  saída: "T: N vaga(s) livre(s) em jogo. Se ninguém escalar até {abre}, viram repescagem —
          volte às {abre} (ou marque Quero no calendário em T e eu te aviso)."
```

Exemplo com os dados de hoje, interno com meta fechada e sem extra, que pergunta
"Dia 09/11 tem?":

> Agora nada em 09/11 é para você: sua meta está completa e vaga liberada vai
> primeiro para quem precisa repor.
> **O que ainda pode abrir em 09/11:**
> - **Dia:** 8 vagas livres em jogo. Se ninguém escalar, viram repescagem **dom 08/11 às 20h**. Aí você pega direto, como extra (um só por interno).
> - **Noite:** 9 vagas livres. A repescagem abre **seg 09/11 às 11h**.
> Marque **Quero** em 09/11 no calendário que eu te aviso na hora em que abrir. Não precisa ficar olhando.

O mesmo interno, se já tiver extra no histórico: "a repescagem não é para
você (já tem um extra)". Isso evita conferir o site a noite toda à toa, como
aconteceu de 29 para 30/10.

Custo: zero token (caminho direto). Fontes: `listFreeOffers` (já usada),
`aberturaDaRepescagem`, `meta.jaTemExtra`, fila de quem recebe aviso.

### 2. Cartão "Me avise" em vez de "volte às 20h"

O aviso de repescagem já existe para quem marcou Quero. O cartão leva direto ao
calendário naquele turno (`/intern/calendario?data=…`). Quem não sabe que o Quero
gera aviso passa a saber.

### 3. Mudanças na regra (decisão de produto, depois de 1 e 2)

- **A. Sobra da grade na repescagem.** Lugar da grade de uma faculdade em turma
  que segue sem ninguém 8h antes entra na repescagem. Pode ir só para internos
  da mesma faculdade ou para todos. É onde mora o desperdício: dezenas por dia
  contra unidades de vaga liberada.
- **B. Agenda pública da repescagem.** Na aba Extras: "próximas 48h: o que pode
  cair e a que horas abre". É a previsão de 1 para quem não pergunta.
- **C. Fila de interesse no lugar da corrida.** Quem marca Quero entra numa
  fila. Na abertura, o sistema distribui por prioridade (precisa da meta >
  nunca teve extra > ordem de marcação), em vez de "quem clicar primeiro às
  20h". Acaba com a necessidade de voltar ao site numa hora certa. É mais
  justo, mas muda o jogo (o "primeiro que pegar" sai).

## Perguntas abertas

1. Começar só por 1 e 2 (não mudam regra)?
2. A: a sobra da grade entra na repescagem? Para a própria faculdade ou para
   todas? A sobra da CRU (CENTRAL) entra também? Ela é a maior parte.
3. C: trocar a corrida das 20h pela fila de interesse?
4. A disputa ("8 vagas, 23 colegas avisados") deve aparecer em número ou só
   como "folgada / disputada"?

## Validação antes de codar

- Script `tsx` sobre produção (só leitura) que monta o bloco "o que ainda pode
  abrir" para os 7 internos que usaram a Dai, nos dias que eles perguntaram.
  Mostrar as amostras antes do merge.
- Teste com relógio fixo: 23h de sáb (diurno de dom já em repescagem, noturno
  ainda não), 10h59 e 11h00 do dia do noturno, e interno com extra no
  histórico.
