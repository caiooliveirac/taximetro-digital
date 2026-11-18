# PLAN — remanejar pela Dai

Status: **as três fases no ar** (18/11/2026), com as decisões do Caio abaixo.
- Fase 1: `5395108` (Dai: intenção REMANEJAR, ferramenta `remanejar_agora`,
  atalho `/intern?avisar=` e `/intern?remanejar=&destino=` no card do plantão);
  líder avisado no remanejamento: `d4fdca5`.
- Fase 2: `89f65f4` (base desativada vale como aviso; aviso LOTACAO).
- Fase 3: `60a57f7` (`/api/intern/mudar-de-base`, intenção MUDAR_BASE,
  ferramenta `mudar_de_base`, botão Mudar).

Correção no caminho: a grade de remanejamento fica no card do plantão, **aba
Hoje** (`AvisoCoordenacao`), não na aba Check-in. A Dai dizia "aba Check-in".

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

## Decisões (Caio, 18/11/2026)

1. **Fase 1**: vai assim, só guia e atalho. A Dai não grava nada; quem move é
   o toque no card do plantão.
2. **Lotação**: sai **o último a chegar** (check-in mais recente; quem ainda
   não fez check-in excede se a base já encheu sem ele). Vira um **4º aviso**,
   `LOTACAO` ("Base lotada"), que a coordenação recebe como os outros. O
   servidor só aceita de quem passou do teto (`capacidadeDaBase`); sem teto
   próprio (LF90) não há lotação. Código: `excedeOTeto`, `lotacaoDoPlantao`.
3. **Base desativada** no quadro dos médicos **conta como aviso**: a grade
   abre sem tocar em Avisar; motivo "base desativada no quadro dos médicos"
   (`AVISO_DESATIVADA` em `ultimoAviso`).
4. **Antes do dia**: o interno **troca sozinho**, sem aprovação. Só por vaga
   livre do mesmo dia, turno e tipo (meta e descanso não mudam), fora da
   janela da repescagem, cabendo na base de destino; liberada pelo líder da
   própria faculdade segue só para as outras. Numa transação: pega a vaga,
   move o plantão (nota `[MUDOU DE BASE]`) e abre o lugar antigo como vaga
   livre (`autoRelease = "INTERNO"`). `mudar-de-base-do-interno.ts`.
5. **Aviso**: remanejamento e mudança de base avisam **a coordenação e o líder
   da faculdade** (líder pela Dai: `DAI_AVISO_REMANEJAMENTO`,
   `DAI_AVISO_MUDANCA_DE_BASE`; coordenação pelo secretário no remanejamento e
   pelo Telegram na mudança antes do dia).

## Perguntas como estavam

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
