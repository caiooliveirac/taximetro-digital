# PLAN — Dai discute os casos do plantão (texto pronto, sem IA gerando)

Objetivo: o interno revisa as emergências que mais aparecem no plantão dele,
com texto vindo de referência, sem custo de modelo por conversa.

## Decisão (Caio, 2026-10-29)

Nada de avaliação dinâmica da resposta do interno (o `/analisar` do
gatekeeper): com ~400 internos ativos, conversa livre por tema custa caro e
abre espaço para o modelo inventar conduta. O Dai fica na zona de conforto:

- **identifica o tema** que o interno quer discutir (roteador sem modelo);
- **sugere revisar** um tema antes do plantão;
- **entrega o texto curado como está**, sem resumir, reescrever ou comentar.

Discutir uma charada **não chama modelo nenhum**: o interno escreve a
tentativa dele e só então abre o gabarito. Texto genérico, não personalizado
— é o preço de 0 token por conversa, e a gente melhora os textos em vez de
gerar resposta. Se o roteador não acha o tema, o Dai mostra os temas em
botões (sem fallback de modelo).

O modelo nunca recebe a descrição da ocorrência (texto livre, pode ter dado de
paciente).

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
              │ achou ──► ficha do tema + "Tentar um caso"
              └ não achou ──► botões com os temas disponíveis

"Tentar um caso" (0 chamadas):
  1. caso sem título: "Caso · IAM · nível 4" + estímulo
  2. caixa "Sua conduta" — precisa escrever algo (mín. ~40 caracteres) para liberar
  3. "Ver resposta": nome do caso ("Era: De Winter Disfarçado"), armadilha,
     resposta-padrão, follow-up e referência, com a tentativa dele em cima
     para comparar
```

A escolha do caso segue o anti-repetição do gatekeeper, só por interno: casos
do tema que ele ainda não abriu; esgotou, recomeça pelo mais antigo.

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

### O título entrega o diagnóstico

No gatekeeper, o `snippet_pergunta.j2` põe `— {{ nome_memoravel }} —` logo
acima do estímulo, e o nome conta a resposta: "De Winter Disfarçado" num caso
que pergunta por que ativar a hemodinâmica, "Wellens Avisa", "Dissecção
Calada", "Sgarbossa Esquecido", "O AVC que Não Era". Era essa linha que o Caio
apagava à mão antes de mandar.

Regra no Dai: **antes da resposta, só tema, nível e estímulo.** `nome_memoravel`,
`armadilha`, `tags` e `referencia` aparecem só depois de "Ver resposta". Teste
garante que o cartão fechado não contém nenhum desses campos.

O estímulo em si está limpo: num script sobre as 60, 19 citam um termo do id
(`fast`, `d-dímero`, `lactato`, `contraste`…), mas é dado do caso, não spoiler.
A exceção a revisar à mão na exportação: `iam-minoca-investigacao` termina com
"Como investiga MINOCA?" — o diagnóstico já está na pergunta; trocar por "Como
segue a investigação?".

## Onde o conteúdo mora

Recomendação: **arquivos no repositório** (`content/dai/fichas/*.json` +
cópia das 60 charadas exportada do gatekeeper), lidos no build.

- Revisão por PR: texto clínico muda com diff e responsável.
- Vale no SAMU, na Vitalmed e no dev sem schema extra (a Vitalmed não tem o
  schema `gatekeeper`).
- Os textos vão ser melhorados aqui (Caio, 2026-10-29), então depois da
  exportação **a cópia do taxímetro passa a ser a fonte**. O gatekeeper está
  parado desde julho e o último conteúdo é de 2026-04-28; não há sincronia de
  volta.

Alternativa: ler `gatekeeper.desafios` direto do banco (fonte única, mas só
existe no SAMU de produção e exige outro caminho no dev e nos testes).

Registro de "abriu a ficha": evento no `audit_log` (`DAI_FICHA_ABERTA`,
`entity_id` = id da ficha), como o plantão ao vivo já faz. Sem tabela nova.

## Fases

1. **Tentar um caso** — no ar desde 2026-10-29 (`src/content/dai-casos.json`,
   `src/lib/dai-casos.ts`, `src/lib/dai-temas.ts`, `api/intern/casos`, atalho
   "Discutir um caso" no Dai; evento `DAI_CASO_ABERTO` com `payload.caso`): exportar as 60 (sem o título no cartão fechado, MINOCA
   corrigida), tema no roteador do Dai, cartão com tentativa obrigatória e
   depois "Ver resposta". Atalho "Tentar um caso". Custo de modelo: 0.
2. **Fichas de plantão** — PCR, convulsão e agitação/suicídio/intoxicação
   redigidas em `src/content/dai-fichas.json`, em revisão por PR (2026-10-29).
   Tema com ficha abre pela ficha; "Tentar um caso" aparece se houver charada.
   Trauma, AVC e IAM entraram em seguida (2026-10-29). Fontes conferidas no
   texto aberto: RCUK 2025 (versão do ERC), NICE NG39/NG41/NG128/NG185/CG95,
   AES 2016, ESETT, CRASH-2, consenso brasileiro de agitação. AHA e a revista
   do ERC barram leitura automática. para os 6 temas que mais aparecem: PCR, trauma,
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

## Respondido (Caio, 2026-10-29)

- Resposta da charada: **só depois que o interno tenta**. Sem avaliação.
- Sem LLM para responder; texto genérico, melhorado com o tempo.
- Título da charada não aparece antes da resposta (ver acima).
- Conteúdo no repositório (decorre de "a gente pode incrementar os textos").

## Perguntas abertas

1. Quem revisa as fichas: só o Caio, ou um preceptor por tema?
2. Referência-base do pré-hospitalar: Protocolos SAMU/MS (SBV/SAV) e qual
   edição? AHA 2025 para PCR?
3. Guardar a tentativa do interno? Recomendação: não na fase 1 (sem tabela,
   sem dado novo para cuidar). Se o preceptor quiser ler as tentativas, vira
   tabela própria na fase 3.
