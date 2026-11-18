/**
 * Perguntas de regra e de app que têm uma resposta só, sem dado do interno:
 * horário do turno, justificativa e abono, comprovante, calendário, instalar,
 * "largar é trocar?", "a minha é substituída?", "vira extra?". Saem direto,
 * sem modelo — no audit_log (DAI_PERGUNTA, 29/10 a 17/11) o modelo respondia
 * várias delas com ferramenta errada ("Todos os seus plantões estão contando"
 * para pedido de comprovante; situação da base para "que horas é o fim do
 * turno").
 *
 * Cada texto sai do código, não de suposição: turnos em utils.ts
 * (getShiftLabel), abono em app/intern/page.tsx, sorteio em
 * sorteio-repescagem.ts, meta em luna-inteligencia.ts (avaliarOferta). Regra
 * nova aqui só com fonte no código ou decisão do Caio.
 */

export type Regra = { chave: string; texto: string };

const REGRAS: { chave: string; quando: RegExp; nao?: RegExp; texto: string }[] = [
  {
    chave: "HORARIO",
    quando: /\b(que horas?|qual (a )?horas?|qual (o )?horario|horarios?)\b.*\b(turno|plantao|plantoes|cru|crl|usa|regulacao|leitos?|comec\w*|inici\w*|termin\w*|acab\w*|fim|cheg\w*|entrada|saida|sai)\b|\b(fim|inicio|comeco) do (turno|plantao)\b/,
    nao: /\b(medic\w*|preceptor\w*|sorteio|repescagem|abre|abriu|check ?-?(in|out)|vaga)\b/,
    texto: "Os turnos são de 12h, iguais na USA, na CRU e na CRL (regulação de leitos): **diurno das 7h às 19h** e **noturno das 19h às 7h** do dia seguinte. Se o seu plantão aparece como manhã ou tarde, é meio turno: manhã 7h–13h, tarde 13h–19h. Seus dias e turnos estão na aba **Calendário**.",
  },
  {
    chave: "SORTEIO",
    quando: /\b(sorteio|repescagem)\b.*\b(que horas?|quando|horario|ganhei|ganhou|resultado|sai|saiu|meu extra)\b|\b(que horas?|quando|resultado|ganhei)\b.*\b(sorteio|repescagem)\b|\bmeu extra do sorteio\b/,
    texto: "O sorteio da repescagem roda 8h antes do turno: **às 20h da véspera** para o diurno e **às 11h do dia** para o noturno, entre quem se inscreveu em **Extras → Sorteios**. Inscritos e resultado ficam públicos lá. Quem é sorteado já entra na escala: o plantão aparece no seu **Calendário** (ou pergunte \"meus próximos plantões\").",
  },
  {
    chave: "JUSTIFICATIVA",
    quando: /\babon\w*|\bjustificativa\b.*\b(avalia\w*|aprova\w*|analisa\w*|demora\w*|prazo|quando|quanto tempo|quem)\b|\b(prazo|quanto tempo|quando|quem|como|onde)\b.*\bjustific\w*/,
    texto: "Falta se justifica no app: na aba **Hoje** (ou em **Histórico**), toque em **Justificar falta** no plantão. Quem avalia é a coordenação, que pode abonar — falta abonada conta para a sua meta, sem virar presença. O app não marca prazo para essa avaliação; se estiver demorando, fale com a coordenação.",
  },
  {
    chave: "COMPROVANTE",
    quando: /\b(comprova\w*|declaracao|certificado|imprimir|impresso|documento fisico)\b|\bhistorico\b.*\b(plantao|plantoes|ocorrencias?|dia|onde|como|acess\w*|ver)\b|\b(onde|como)\b.*\bhistorico\b/,
    texto: "O app não emite comprovante nem declaração. Seus plantões, presenças e faltas ficam na aba **Histórico**; as ocorrências clínicas que você registrou, na aba **Ocorrências**. Documento oficial, peça à coordenação.",
  },
  {
    chave: "CALENDARIO",
    quando: /\bsincroniz\w*|\bgoogle (agenda|calendar)\b|\b(agenda|calendario) do (celular|google|iphone)\b|\bexportar\b.*\b(plantoes|calendario|agenda)\b/,
    texto: "Ainda não dá para sincronizar com o Google Agenda ou o calendário do celular. Seus plantões ficam na aba **Calendário** do app, sempre atualizados.",
  },
  {
    chave: "INSTALAR",
    quando: /\binstal\w*|\bbaixar o (app|aplicativo)\b|\btela inicial\b|\btem (app|aplicativo)\b/,
    texto: "Não precisa de loja de apps: abra o Taxímetro no navegador do celular e use **Adicionar à tela inicial** (Android/Chrome: menu ⋮; iPhone/Safari: botão Compartilhar). Ele passa a abrir como app, em tela cheia.",
  },
  {
    chave: "LARGAR_TROCAR",
    // "largar é trocar?" sem acento é "largar e trocar?": só a frase inteira, senão "quero largar e trocar o meu" cairia aqui.
    quando: /\b(largar|liberar|soltar)\b.*\b(seria|eh|e o mesmo|mesmo que|igual|mesma coisa)\b.*\btroca\w*|\btroca\w*\b.*\b(seria|eh|e o mesmo|mesmo que|igual|mesma coisa)\b.*\b(largar|liberar)\b|\bdiferenca entre (largar|liberar|trocar)\b|^(largar|liberar) e trocar\W*$/,
    texto: "Não é a mesma coisa. **Trocar**: um colega fica com o seu plantão e você com o dele (mesmo tipo, 12h de descanso dos dois lados); sua meta não muda e só vale quando ele confirma, na aba **Trocas**. **Liberar** (largar): você sai da escala sem falta, a casinha volta a ficar vazia e a vaga fica livre para os colegas; é você quem toca em Liberar — me diga \"não vou poder ir\".",
  },
  {
    chave: "SUBSTITUI",
    quando: /\bsubstitu\w*|\bno lugar d[oa] (meu|minha)\b|\b(perco|perde|sai) (o meu|a minha|meu plantao|minha vaga)\b/,
    texto: "Não: pegar uma vaga soma um plantão à sua escala, não troca o que você já tem — e só dá se não bater com o seu descanso de 12h. Para ficar com outro no lugar do seu, é **troca** (aba Trocas). Para sair do seu, é **liberar**: me diga \"não vou poder ir\".",
  },
  {
    chave: "CONTA_OU_EXTRA",
    quando: /\b(vira|se torna|entra como|conta como|fica como)\b.*\bextra\b|\bextra ou (entra|conta|carga|meta|na meta)\b|\bcarga horaria\b/,
    texto: "Depende de onde vem a vaga e da sua meta naquele tipo. Vaga liberada, sobra da grade e repescagem contam na meta enquanto você tem casinha vazia no tipo; com a meta do tipo fechada, entram como extra. Extra publicado pelo líder nunca conta. E extra é um por interno.",
  },
];

/** `q` já normalizado (sem acento, minúsculo). */
export function regraDaPergunta(q: string): Regra | null {
  if (q.length > 200) return null;
  const r = REGRAS.find((x) => x.quando.test(q) && !x.nao?.test(q));
  return r ? { chave: r.chave, texto: r.texto } : null;
}
