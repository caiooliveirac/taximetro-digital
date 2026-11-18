# PLAN — remanejar pela Dai

Status: **proposta, aguardando decisões do Caio** (18/11/2026). Nada codado.

## O que existe hoje

- **Remanejamento pelo próprio interno** (`/api/intern/remanejamento`,
  `src/lib/remanejamento-interno.ts`). Exige três coisas:
  - plantão **em andamento**;
  - um **aviso de pé** (sem médico, sem enfermeiro ou problema na viatura),
    dado no card do plantão, aba Hoje → Avisar;
  - **vaga de grade** no destino (soma de `slot_rules.capacity` menos quem
    está lá), aberta a partir da tolerância.

  O interno escolhe a base na aba Check-in e a coordenação é avisada.
- **Coordenação**: Plantão ao vivo (`mover`/`devolver`) e
  `PATCH /api/assignments/reassign`. O líder também pode, mas só nos
  plantões da faculdade dele.
- **Dai**: não remaneja nem leva até a tela. Desde 18/11 ela orienta: "o
  remanejamento abre depois do aviso; lotação, fale com o líder ou a
  coordenação".

## Números (30 dias até 18/11)

| Quem remanejou | Quantos | Motivo |
|---|---|---|
| Interno | 75 | 48 sem médico, 19 sem enfermeiro, 8 viatura |
| Coordenação | 55 | Plantão ao vivo, devoluções, sem motivo registrado |
| Líder | 3 | — |

Log da Dai (576 perguntas, 29/10–17/11): 9 pedidos de remanejar que ela não
atendeu.
- "Está com muitos internos, posso ir para outra base?" (3)
- "Sem espaço na ambulância, tem outra base?" (2)
- Base desativada depois do check-in (2)
- "Quero trocar para a PM40" (2): plantão futuro, ou seja, troca de base
  antes do dia.

## Proposta em fases

**Fase 1 — a Dai leva ao remanejamento que já existe (sem regra nova).**
Intenção REMANEJAR no roteador ("posso ir para outra base", "base parada",
"sem médico, e agora?"). A resposta depende do estado do plantão de hoje:
- Sem aviso: botão que abre o card do plantão em Avisar.
- Com aviso: lista as bases com vaga de grade agora, cada uma com botão que
  abre a aba Check-in já com o destino escolhido. A Dai não move ninguém;
  quem move é o toque na tela atual.
- Fora do turno ou base fora do remanejamento: diz por quê.

Esforço pequeno: reaproveita `vagasLivresDoInterno` e o GET da rota.

**Fase 2 — lotação como motivo (regra nova).**
Base acima do teto físico (`capacidadeDaBase`) libera o remanejamento sem
aviso, só para quem excede. Exemplo: o 3º na SM01 diurna.

**Fase 3 — mudar de base antes do dia (regra nova).**
"Quero ir para a PM40 dia 25": o interno troca o próprio plantão futuro por
uma vaga livre do mesmo dia e turno. Seria a liberação (`INTERNO`, já no ar)
mais a pegada da vaga, num passo só.

## Decisões abertas (Caio)

1. A **fase 1** pode ir assim (só guia e atalho, sem regra nova)?
2. **Lotação (fase 2)**:
   - quem sai: o último a chegar (check-in mais recente), o último escalado,
     ou quem pedir primeiro?
   - pode sair sem aviso à coordenação, ou o motivo "lotação" vira um aviso
     novo (`TIPOS_DE_AVISO`)?
3. **Base desativada no quadro dos médicos**: conta como aviso automático
   (remaneja sem tocar em Avisar) ou continua exigindo o aviso?
4. **Antes do dia (fase 3)**: o interno pode se mover sozinho para uma vaga
   livre de outra faculdade? Hoje vaga livre fora da repescagem é escalada
   pelo líder. Ou fica pelo líder (pedido) ou pela troca?
5. **Aviso**: remanejamento pela Dai avisa só a coordenação (como hoje) ou
   também o líder da faculdade?
