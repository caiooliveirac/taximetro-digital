# PLAN — Calendário do interno vira painel de trocas

Status: Fase 1 implementada em 2026-10-29 (`src/components/intern-calendar.tsx`,
`src/lib/fita-turnos.ts`); Fases 2–4 propostas.

## 1. O que está errado hoje (verificado)

**Visual** (`src/components/intern-calendar.tsx`, `src/lib/base-colors.ts`)

- A célula do dia mostra o código da base (`SM01`, `CRU`) em 9 px, numa
  faixa de 15 px. Ninguém lê "CC70" e entende "Cabula".
- A paleta por código tem 12 cores, uma por base USA. **CRU, CRL e LF90 não
  estão nela** e caem no cinza de fallback. CRU é 37% de todos os plantões
  (1.465 de ~3.950 nos últimos 60 dias): o plantão mais comum é o mais apagado.
- Duas lógicas de cor no mesmo fluxo: a grade pinta por código
  (`getBaseStyleByCode`), a ficha do dia pinta por tipo (`getBaseStyle`, USA =
  vermelho). O mesmo plantão muda de cor ao abrir.
- Nada na tela diz o que é USA, CRU, CRL. A legenda lista códigos, não
  explica que USA é ambulância na rua e CRU é regulação dentro da central.
- 2/3 da tela são legenda e barra de progresso; o calendário é 7 colunas de
  quadradinhos de 76 px no celular.

**Trocas** (produção, `requests` tipo SWAP, últimos 90 dias)

| | |
|---|---|
| Ofertas de troca criadas | 892 |
| Concluídas | 271 (30%) |
| Canceladas pelo próprio interno, sem nota | 489 (55%) |
| Abertas hoje | 181, das quais **167 já venceram sem par** |
| Mediana oferta → plantão | 13 dias |
| Mediana até concluir (quando conclui) | 4,9 h |

Leitura: quando há par, a troca fecha em horas. O problema não é o fluxo de
aprovação, é **achar o par**. A oferta vai para um mural genérico e espera
alguém passar por ela.

## 2. Ideia central

O calendário deixa de ser só "onde eu vou estar" e passa a carregar dois
sinais que o interno dá sobre os dias dele:

| Sinal | O que o interno diz | Uso |
|---|---|---|
| **Outro serviço** | "Nesse dia/turno tenho plantão em outro lugar" | Plantão SAMU nesse dia vira candidato a troca; ninguém oferece esse dia para ele |
| **Quero / Posso** | "Nesse dia/turno quero (ou topo) pegar plantão" | Ele aparece como demanda para quem oferta aquele dia |

Com os dois sinais, o sistema cruza ofertas e pessoas antes de alguém precisar
garimpar o mural:

- **Para quem oferta**: no momento de ofertar o plantão do dia D, já vê
  "3 pessoas sinalizaram que querem plantão em D", e a oferta vai direto para
  elas.
- **Para quem procura**: "Ofertas para você" lista primeiro as que caem em dias
  em que ele marcou *quero plantão*, e cujo plantão de volta ele consegue dar
  (cai num dia em que ele marcou *outro serviço* = troca perfeita).
- **Preferência de base**: o interno marca bases favoritas e bases a evitar;
  entra como peso no ranking, nunca como filtro.

## 3. Regras que já existem e o ranking tem que respeitar

O ranking só sugere trocas que o `handle-swap-peer-action` aceitaria:

- Entre faculdades diferentes, só USA (`cross-faculty-swap-policy.ts`).
- CRU: uma troca por rodízio (`cru-swap-quota-policy.ts`) — quem já gastou a
  cota não recebe sugestão de CRU.
- Descanso de 12 h para os dois lados (`findSwapRestConflict`).
- Extra não troca; só SCHEDULED/CONFIRMED; oferta morre no início do turno
  (`shiftAlreadyStarted`).
- Meio turno EBMSP não casa com plantão de 12 h.

Sugestão que o servidor recusaria depois é pior que sugestão nenhuma.

## 4. Fases

Cada fase vai sozinha ao LIVE e é reversível por revert.

### Fase 1 — Calendário legível (sem schema)

Protótipo: `docs/prototipos/calendario-fita.html`.

**Ideia de forma: a fita de turnos.** A regra de descanso
(`rest-policy.ts`) trata o tempo como uma sequência contínua de turnos de
12h: noite de D-1 → dia de D → noite de D → dia de D+1. O calendário desenha
exatamente isso: cada dia é uma linha com duas faixas, **diurno à esquerda,
noturno à direita**. Lido como texto, a noite de D termina e a linha seguinte
começa com o dia de D+1 — o turno colado fica literalmente ao lado.

- **Diurno e noturno diferentes em tudo**: posição (esquerda/direita), fundo
  (papel claro / tinta escura, nos dois temas), textura (liso / pontilhado),
  e o próprio plantão (bloco sólido de cor de dia; contorno luminoso sobre
  tinta à noite). Sem ícone de sol/lua: o espaço fica para o nome do local.
- **Tipo pela cor e pela palavra**, não pelo código: Ambulância (coral),
  Regulação (violeta), Leitos (verde-água). Base pelo nome ("Cabula"), nunca
  "CC70". Uma só função de estilo para grade, ficha e Trocas.
- **Descanso desenhado**: os turnos colados num plantão ficam pautados
  (linhas horizontais) com "colado em X". Tocar ali em modo Quero/Posso
  explica por que não pode.
- **Visão do rodízio no topo**: 4 semanas × 14 quadradinhos (dia, noite,
  dia, noite...). O rodízio inteiro numa olhada, tocar leva à linha.
- Cabeçalho "Diurno 07→19 | Noturno 19→07" preso no topo ao rolar.
- **"O que é cada coisa"**: cartão recolhível de três linhas (USA, CRU, CRL)
  dizendo o que se faz em cada uma, aberto na primeira visita.
- Barra de progresso vira uma linha compacta no topo.
- Ficha do dia ganha o botão **Ofertar para troca** (hoje só em /intern/trocas).

Risco: nenhum dado muda. Ajuste da réplica `mnrs-portal/portal/_portal/demo/taximetro.html` e `V_DEMO` na mesma tarefa (regra 6).

### Fase 2 — Marcar "outro serviço" e "quero plantão"

- **Modo marcar**: um seletor no topo do calendário (Ver · Outro serviço ·
  Quero · Posso). No modo marcar, cada toque num dia cicla SD → SN → SD+SN →
  limpo. Marcar quatro sextas leva quatro toques.
- Faixa: outro serviço = hachura diagonal com etiqueta ("UPA Brotas");
  quero = contorno âmbar; posso = contorno azul.
- **Outro serviço entra na regra de descanso** como se fosse plantão: plantão
  SAMU no mesmo turno ou colado nele = colisão (contorno vermelho nos dois),
  com "Ofertar para troca" na ficha.

**Dado.** Reaproveitar `intern_unavailability` (date, period, reason, notes,
unique por interno/dia/turno), que no SAMU está vazia (0 linhas) e cujo
único leitor de peso, o sorteio, só lê com a feature `internUnavailability`
ligada (`run-leader-lottery.ts:263`). Acrescentar ao enum `OUTRO_SERVICO`,
`QUERO` e `POSSO` (migration aditiva, não destrutiva). `notes` guarda a etiqueta.
No SAMU os dois sinais são **só para trocas**: o sorteio continua ignorando.
Feature nova `sinaisDeTroca` em `instance.ts`.

### Fase 3 — Casamento de ofertas

Função pura `rankSwapMatches` em `src/shared/domain/policies/`, testada com
node:test, recebendo plantões, sinais e regras; devolve pares com motivo
legível.

Elegibilidade decide (seção 3), sinais explicam, pontuação ordena. Caixas,
como no escalasetrocas:

1. **Troca perfeita**: B marcou QUERO/POSSO no dia de A **e** tem plantão
   num dia em que marcou outro serviço, onde A está livre. Os dois resolvem
   um problema.
2. **Combina**: B marcou QUERO/POSSO no dia de A; A escolhe entre os plantões
   de B que pode assumir.
3. **Livre**: B pode, sem sinal. Subordem: já fez esse dia da semana nos
   últimos 90 dias.
4. Desempate: base favorita (+) / evitada (−) de cada lado, QUERO antes de
   POSSO, antecedência.

Cada sugestão carrega a frase do porquê ("Você marcou outro serviço em 14/11;
Ana quer plantão em 14/11 e tem um no dia 20, quando você está livre").

Telas:

- **Ao ofertar**: "18 colegas podem · 3 marcaram este dia · 1 troca
  perfeita" antes de confirmar. A oferta segue para o mural como hoje, mas os
  interessados a veem no topo da aba "Para você".
- **Minhas ofertas abertas**: o mesmo resumo continua visível enquanto a
  oferta vive, e muda quando alguém marca o dia depois. Oferta sem resposta
  há 3 dias ganha destaque (mesma regra do mural do escalasetrocas).
- **No calendário**: dia com oferta compatível ganha um selo com o número.
  Toque abre a ficha com as ofertas daquele dia.
- **Em Trocas**: aba "Para você" acima do mural.
- **Privacidade**: o ofertante vê só a contagem ("3 interessados"); o nome
  aparece quando o interessado propõe. Sinais de outro serviço nunca são
  mostrados a outros internos.

Query: tudo que o ranking precisa é por faculdade/rodízio e janela de ~6
semanas — cabe numa leitura por request, sem tabela de cache.

### Fase 4 — Preferência de base e aviso

- Preferência: lista curta no perfil (até 3 favoritas, até 3 a evitar), em
  tabela própria `intern_base_preferences` (uma linha por interno/base/peso).
- Aviso ativo (Telegram, já existe `telegram_bindings`): "Apareceu oferta no
  dia 14, que você marcou como quero plantão". **Envio real de mensagem —
  precisa de autorização explícita antes de ligar.**

## 5. Fora do escopo

- O sorteio passar a respeitar "outro serviço" no SAMU (decisão de produto
  separada; hoje é Vitalmed only e o teste `instance-features` protege).
- Troca em cadeia (A→B→C). Ver seção 6.
- Calendário do líder/coordenador.

## 6. O que vem do escalasetrocasSAMU

Lido em `~/Projetos/escalasetrocassamu` (ADRs 002, 006, 007).

**Copiar**

- **Duas intenções, não uma**: `QUERO` (âmbar, peso 40) e `POSSO` (azul,
  peso 20) por dia/turno (`lib/tipos.ts:469`). Nosso "quero plantão" vira os
  dois; QUERO dispara aviso, POSSO só ordena.
- **Toque cíclico no dia**: SD → SN → SD+SN → limpo (`minha-client.tsx:1987`),
  com a "caneta" escolhida antes. É o modo marcar da Fase 2.
- **Ordem do raciocínio** (ADR 002): elegibilidade decide → sinais explicam →
  pontuação ordena. Cada ponto vira uma frase pronta ("você marcou QUERO
  nesse dia"), mostrada ao lado da sugestão.
- **Caixas em vez de lista única** (`lib/oportunidades.ts:43`):
  `COMBINA` (elegível + sinal), `LIVRE` (elegível sem sinal), `SO_TROCA`
  (só dá se devolver um plantão — conflito de turno ou descanso), `FORA`.
  No taxímetro toda oferta é troca, então `SO_TROCA` é o caso comum: a caixa
  diz *qual* plantão seu resolve.
- **Painel do ofertante** (`lib/anuncios.ts:94,147`): "12 colegas alcançam ·
  3 marcaram este dia", agrupado por motivo: marcou o dia → já fez esse dia
  da semana nos últimos 90 dias → viu e não respondeu → só pode. É
  exatamente o "ofertante vê de cara quem sinalizou interesse".
- **Privacidade** (ADR 006): casamento individual nunca vai a grupo; só a
  pessoa recebe.

**Fazer diferente**

- Lá não existe "não posso"; a indisponibilidade é deduzida de escala e
  afastamento. Aqui o interno tem vida fora do SAMU, então **outro serviço**
  é sinal novo — e o mais valioso: diz qual plantão ele precisa largar, e
  completa a "troca perfeita".
- Lá o servidor manda só as preferências do próprio usuário e o "marcaram
  este dia" sai incompleto no cliente (lacuna registrada na ADR 006). Aqui o
  agregado é calculado no servidor e só a contagem desce para o cliente.
- Lá preferência de base é conjunto plano (+20 em qualquer). Aqui: favorita
  soma, evitada subtrai.
- Troca em cadeia (`lib/cadeia.ts`) fica para depois: 3-4 pessoas com cota
  de CRU, faculdade e descanso é muita regra para a primeira versão.

## 7. Decisões abertas

1. Reaproveitar `intern_unavailability` ou tabela nova `intern_day_signals`.
2. Interno pode ver *quem* quer plantão num dia ou só a contagem.
3. "Quero plantão" também serve para vaga livre/extra (`extra_shift_offers`)
   ou só para troca.
4. Ordem: Fase 1 sozinha primeiro, ou 1+2 juntas.
