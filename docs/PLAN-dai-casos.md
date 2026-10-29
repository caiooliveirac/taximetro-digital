# PLAN — Dai discute os casos do plantão (texto pronto, sem IA gerando)

Objetivo: o interno revisa as emergências que mais aparecem no plantão dele,
com texto vindo de referência, sem custo de modelo por conversa.

## Decisão (Caio, 2026-10-29)

Nada de avaliação dinâmica da resposta do interno (o `/analisar` do
gatekeeper): com ~400 internos ativos, conversa livre por tema custa caro e
abre espaço para o modelo inventar conduta. O Dai fica na zona de conforto:

- **identifica o tema** que o interno quer discutir (roteador sem modelo;
  modelo só como fallback, devolvendo um tema da lista e nada mais);
- **sugere revisar** um tema antes do plantão;
- **entrega o texto curado como está**, sem resumir, reescrever ou comentar.

O modelo nunca recebe a descrição da ocorrência (texto livre, pode ter dado de
paciente). No máximo o apelido do caso, e só se o roteador não resolver.

## Fonte do conteúdo

**gatekeeper** (`caiooliveirac/gatekeeper`, bot de Telegram do preceptor,
parado desde 2026-07-11). Schema `gatekeeper` já existe no banco `taximetro`
de produção, dono `taximetro`: 60 charadas ativas, 6 por tema, dificuldade
3–5. Cada uma tem `estimulo`, `armadilha`, `resposta_padrao`, `referencia`
(diretriz/estudo), `follow_up`, `tags`, `nome_memoravel`. Média de ~2,2 mil
caracteres por charada.

Achado: o conteúdo é de **sala vermelha** (tPA, ECMO, azul de metileno,
broncoscopia), escrito para o preceptor provocar o aluno. Serve como "caso
para pensar", mas não como revisão de plantão no pré-hospitalar. Falta uma
**ficha de plantão** por tema.

## Dados: o que os internos registram (produção, 2026-10-29)

1.970 ocorrências em `case_records`. Apelido mapeado para tema por regex (só o
apelido, não a descrição). `*` = tema sem nenhum conteúdo no gatekeeper.

| Tema | Ocorrências | Últimos 90 dias | Gatekeeper |
|---|---:|---:|---|
| Trauma (TCE, moto, queda, FAF/FAB) | 261 | 116 | 6 charadas |
| AVC | 163 | 85 | 6 |
| IAM / dor torácica | 152 | 81 | 6 |
| **PCR** | 119 | 56 | **0** |
| Transporte / transferência | 113 | 79 | não clínico |
| **Convulsão** | 105 | 44 | **0** |
| **Psiquiatria / tentativa de suicídio / intoxicação** | 81 | 44 | **0** |
| Dispneia (EAP, insuf. respiratória) | 63 | 32 | asma/DPOC/TEP |
| Sepse | 61 | 34 | 6 |
| **Hipo/hiperglicemia, CAD** | 38 | 11 | **0** (só como mimic de AVC) |
| **Síncope** | 37 | 15 | **0** |
| **Rebaixamento do nível de consciência** | 35 | 20 | **0** |
| **Obstetrícia** | 30 | 17 | **0** |
| HDA, choque, asma, TEP, anafilaxia, DPOC | 64 juntos | 27 | 36 charadas |
| Outros (cauda longa: óbito, bronquiolite, BAVT, cefaleia…) | 648 | 265 | — |

Por tipo de base (top 6, sem "outros" e transporte):

- **USA**: AVC 149, trauma 142, IAM 123, PCR 106, convulsão 65, psiq/intox 61
- **CENTRAL (CRU)**: trauma 114, convulsão 39, IAM 29, síncope 20, psiq/intox 19, glicemia 14
- **CRL**: quase nada registrado (8)

Leitura: metade das charadas (asma, DPOC, TEP, HDA, choque, anafilaxia) cobre
3% das ocorrências. PCR e convulsão, 2º e 4º temas clínicos mais vistos na
USA, não têm nada.

## Fluxo

```
interno ──► "quero revisar PCR" / atalho "Revisar para o plantão" / ocorrência registrada
              │
              ▼
        roteador (regex de tema, o mesmo mapa da tabela acima)   0 chamadas
              │ achou ──► cartão da ficha (texto do banco, sem modelo)
              │ não achou
              ▼
        modelo classifica: responde só um id da lista de temas   1 chamada, ~300 tokens
              │ tema ──► cartão da ficha
              └ nenhum ──► botões com os temas disponíveis
```

**Sugestão ativa antes do plantão** (determinística, sem modelo): no Início,
no dia do plantão e na véspera, um cartão "Revisar para hoje: PCR". O tema sai
do ranking do tipo de base daquele plantão (tabela acima, recalculado da
`case_records` dos últimos 90 dias), pulando o que o interno já abriu nos
últimos 30 dias.

**Depois de registrar ocorrência**: se o apelido cai num tema com ficha, a
tela de sucesso oferece "Revisar AVC". Um link, sem modelo.

## Formato da ficha (texto pronto)

Campos, não markdown livre: o app não tem renderizador de markdown, e campo
fixo deixa a tela previsível. Mesmo estilo de texto do gatekeeper (linhas com
`•`, renderizadas com `whitespace-pre-line`).

| Campo | Conteúdo |
|---|---|
| `tema`, `titulo` | "PCR no pré-hospitalar" |
| `em_30_segundos` | 3–5 linhas: o que fazer primeiro |
| `nao_pode_faltar` | checklist da conduta na USA/CRU |
| `armadilha` | o erro mais comum |
| `caso` | opcional: id de uma charada do gatekeeper do mesmo tema; abre o `estimulo` e esconde a `resposta_padrao` atrás de "Ver resposta" |
| `referencia` | diretriz e ano (ex.: AHA 2020/2025, Protocolos SAMU/MS) |
| `revisado_por`, `revisado_em` | quem conferiu o texto |

A charada do gatekeeper também é exibida sozinha, com os campos dela, para os
temas sem ficha.

## Onde o conteúdo mora

Recomendação: **arquivos no repositório** (`content/dai/fichas/*.json` +
cópia das 60 charadas exportada do gatekeeper), lidos no build.

- Revisão por PR: texto clínico muda com diff e responsável.
- Vale no SAMU, na Vitalmed e no dev sem schema extra (a Vitalmed não tem o
  schema `gatekeeper`).
- Risco de divergir do gatekeeper: baixo (último commit de conteúdo em
  2026-04-28, bot parado). Se ele voltar a ser curado, um script reexporta.

Alternativa: ler `gatekeeper.desafios` direto do banco (fonte única, mas só
existe no SAMU de produção e exige outro caminho no dev e nos testes).

Registro de "abriu a ficha": evento no `audit_log` (`DAI_FICHA_ABERTA`,
`entity_id` = id da ficha), como o plantão ao vivo já faz. Sem tabela nova.

## Fases

1. **Ler as charadas**: exportar as 60, tema no roteador do Dai, cartão de
   charada com "Ver resposta". Atalho "Revisar um tema". Custo de modelo: 0.
2. **Fichas de plantão** para os 6 temas que mais aparecem: PCR, trauma,
   AVC, IAM, convulsão, psiq/intox. Redigidas offline a partir das
   referências, **revisadas pelo Caio** antes do merge. Nada gerado em
   tempo de execução.
3. **Sugestão ativa**: cartão no Início antes do plantão e link depois de
   registrar ocorrência.
4. Fichas da cauda: síncope, rebaixamento, glicemia, obstetrícia, sepse,
   dispneia.

## Fora de escopo

- Avaliar resposta do interno, nota, veredito (o `/analisar` do gatekeeper).
- Conversa livre sobre o tema ou o modelo comentar a ficha.
- Mandar a descrição da ocorrência para qualquer modelo.
- Push ou Telegram: o aviso é cartão dentro do app (Telegram tem 1 vínculo
  entre 1.157 internos).

## Perguntas abertas

1. Conteúdo no repositório (recomendado) ou lido do schema `gatekeeper`?
2. Quem revisa as fichas: só o Caio, ou um preceptor por tema?
3. Referência-base do pré-hospitalar: Protocolos SAMU/MS (SBV/SAV) e qual
   edição? AHA 2025 para PCR?
4. A charada mostra a resposta na hora ou só depois que o interno escreve a
   dele (sem avaliação, só para forçar pensar antes)?
5. Fallback do modelo para classificar o tema vale a pena, ou só botões
   quando o roteador não achar?
