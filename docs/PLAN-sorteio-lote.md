# Sorteio do lote inteiro (justiça de noturno e de qualidade de base)

## Problema
O sorteio de N semanas era N sorteios de 1 semana. Medido na grade real da UNIFACS
(45 internos, 6 semanas, 47 vagas USA/semana, 16 noturnas), 30 sorteios:

| | noturnos por interno | qualidade média por interno (0–1) | bases repetidas |
|---|---|---|---|
| antes | 0 a 3 | 0,28 a 0,79 | 0,6 |
| agora | 1 a 2 (a faixa justa) | 0,51 a 0,56 | 0 |

Com 2 plantões/semana: plantões por interno 6–10 → 6–7; noturnos 0–4 → 2–3.
Nos dois casos: mesmo total de plantões, zero choque com CRU/CRL, zero 24h seguidas.

## Regra
`lottery-horizon.ts`. Fase 1: emparelhamento máximo por semana (o de sempre) — quem tem
menos plantão no lote entra primeiro. Fase 2: trocas entre quaisquer semanas, só as que
baixam o custo e passam nas mesmas regras duras (`canAssign`).

Custo por interno, só sobre plantão sorteável (CRU/CRL fixo não conta):
plantões vs. média · noturnos vs. cota dele · qualidade vs. cota dele · base repetida².

- **Qualidade** = posição na `BASE_PRIORITY` (SM01 = 1, PP20 ≈ 0,08).
- **Cota de noturno** = noturnos preenchidos ÷ internos; a faixa justa é o piso e o teto disso.
  A tela mostra o mínimo e o máximo que saíram.
- **Regra dura nova:** 12h de descanso também entre dois plantões de USA (antes só contra CRU/CRL).
- Semente do sorteio e o resumo de justiça vão para o audit (`LOTTERY`).

## Em aberto
- Nota de qualidade por base é a ordem da `BASE_PRIORITY`. Se a coordenação quiser
  notas próprias (A/B/C), é trocar `qualidadeDaBase`.
- Custo de tempo: ~1 s para 45 internos × 6 semanas.
