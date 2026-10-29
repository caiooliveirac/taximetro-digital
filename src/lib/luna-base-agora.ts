/**
 * "Estou na base tal, vai ativar?" — resposta pronta, sem modelo, a partir do
 * quadro de médicos do `plantoes` (situacaoDoTurnoNaBase). Puro, para teste.
 *
 * Quem procurar: o médico que chegou para o turno; se ninguém chegou, o que
 * está de saída (ele sabe quem assume). Sem médico depois da tolerância, o
 * caminho é o aviso "Sem médico" e o remanejamento pela aba Check-in
 * (remanejamento-interno.ts).
 *
 * Turno que ainda não começou ("vai ativar amanhã à noite?"): quem a escala
 * médica do Escalas & Trocas prevê na base (escala-medica-repository.ts). O
 * quadro do plantoes só sabe de quem já chegou.
 */

import { REIVINDICACAO_MIN } from "@/lib/remanejamento-interno";
import { ativos, quando, type MeuPlantao } from "@/lib/luna-inteligencia";
import type { SituacaoDoTurno } from "@/features/scheduling/infra/repositories/plantoes-medicos-repository";
import { addDaysToDateStr, getBrazilNowParts } from "@/lib/utils";

export type Turno = { date: string; period: "DAY" | "NIGHT" };

const HORA = { DAY: "07", NIGHT: "19" } as const;
export const inicioDoTurno = (t: Turno) => new Date(`${t.date}T${HORA[t.period]}:00:00-03:00`);
const horaDoInicio = (t: Turno) => `${HORA[t.period]}:00`;
const horaDaTolerancia = (t: Turno) => `${HORA[t.period]}:${String(REIVINDICACAO_MIN).padStart(2, "0")}`;

/** O turno de que se fala agora: das 5h às 17h é o diurno de hoje; depois, o noturno (de ontem, antes das 5h). */
export function turnoDoRelogio(now: Date): Turno {
  const p = getBrazilNowParts(now);
  const hoje = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  if (p.hour >= 5 && p.hour < 17) return { date: hoje, period: "DAY" };
  if (p.hour >= 17) return { date: hoje, period: "NIGHT" };
  return { date: addDaysToDateStr(hoje, -1), period: "NIGHT" };
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

/**
 * O turno que a pergunta pede, quando pede: "amanhã", "sábado", "31/10",
 * "à noite", "de dia". `null` = a pergunta não falou de quando.
 */
export function turnoPedido(texto: string, now: Date): Turno | null {
  const q = norm(texto);
  const relogio = turnoDoRelogio(now);
  const p = getBrazilNowParts(now);
  const hoje = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  let date: string | null = null;
  const dm = q.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (dm) {
    const ano = Number(dm[2]) < p.month - 6 ? p.year + 1 : p.year;
    date = `${ano}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  } else if (/\bdepois de amanha\b/.test(q)) date = addDaysToDateStr(hoje, 2);
  else if (/\bamanha\b/.test(q)) date = addDaysToDateStr(hoje, 1);
  else if (/\bhoje\b/.test(q)) date = hoje;
  else {
    const dia = DIAS.findIndex((d) => new RegExp(`\\b${d}(unda|ca|rta|nta|ta|ado|ingo)?(-feira)?\\b`).test(q));
    if (dia >= 0) {
      const hojeDow = new Date(`${hoje}T12:00:00Z`).getUTCDay();
      date = addDaysToDateStr(hoje, (dia - hojeDow + 7) % 7 || 7);
    }
  }
  const period = /\bnoit|notur|\bsn\b/.test(q) ? "NIGHT" : /\b(de dia|diurn|manha|\bsd\b)/.test(q) ? "DAY" : null;
  if (!date && !period) return null;
  if (!date) return { date: period === relogio.period ? relogio.date : hoje, period: period! };
  return { date, period: period ?? "DAY" };
}

/**
 * Base e turno da pergunta: a base citada, ou a do plantão dele em andamento
 * ou que começa nas próximas 4h; sem isso, o próximo plantão dele. O turno é
 * o pedido na pergunta, senão o dele naquela base, senão o do relógio.
 */
export function baseETurno(meus: MeuPlantao[], now: Date, citada: string | null, pedido: Turno | null = null): { baseCode: string | null; turno: Turno } {
  if (pedido) {
    const naquele = ativos(meus).find((m) => m.date === pedido.date && m.period === pedido.period && (!citada || m.baseCode === citada));
    return { baseCode: citada ?? naquele?.baseCode ?? null, turno: pedido };
  }
  const perto = ativos(meus)
    .map((m) => ({ m, inicio: inicioDoTurno({ date: m.date, period: m.period }).getTime() }))
    .filter(({ inicio }) => inicio - now.getTime() <= 4 * 3_600_000 && now.getTime() - inicio <= 12 * 3_600_000)
    .sort((a, b) => Math.abs(a.inicio - now.getTime()) - Math.abs(b.inicio - now.getTime()));
  const meu = citada ? perto.find(({ m }) => m.baseCode === citada) : perto[0];
  if (meu) return { baseCode: meu.m.baseCode, turno: { date: meu.m.date, period: meu.m.period } };
  if (!citada) {
    // "Minha base vai ativar?" longe do plantão: o próximo dele.
    const proximo = ativos(meus)
      .map((m) => ({ m, inicio: inicioDoTurno({ date: m.date, period: m.period }).getTime() }))
      .filter(({ inicio }) => inicio > now.getTime())
      .sort((a, b) => a.inicio - b.inicio)[0];
    if (proximo) return { baseCode: proximo.m.baseCode, turno: { date: proximo.m.date, period: proximo.m.period } };
  }
  return { baseCode: citada, turno: turnoDoRelogio(now) };
}

export type Previstos = { consultado: boolean; diaSemEscala: boolean; nomes: string[] };

const doutores = (l: { nome: string }[]) => `Dr(a). ${l.map((x) => x.nome).join(" e ")}`;

/** Linha da escala médica: quem está previsto, furo, ou que não deu para ver. */
function linhaDaEscala(baseCode: string, previstos: Previstos | undefined): string | null {
  if (!previstos?.consultado || previstos.diaSemEscala) return null;
  if (!previstos.nomes.length) return `A escala médica não tem ninguém previsto na ${baseCode} nesse turno: sem médico escalado, ela pode não ativar.`;
  const quem = doutores(previstos.nomes.map((nome) => ({ nome })));
  return `Pela escala médica, o previsto é ${quem}${quem.endsWith(".") ? "" : "."}`;
}

export function textoDaBaseAgora(p: { baseCode: string; turno: Turno; now: Date; situacao: SituacaoDoTurno; previstos?: Previstos }): string {
  const { baseCode, turno, now, situacao: s } = p;
  const escala = linhaDaEscala(baseCode, p.previstos);

  // Turno que ainda vai começar: a resposta é a escala, não o quadro.
  if (now < inicioDoTurno(turno)) {
    const horas = (inicioDoTurno(turno).getTime() - now.getTime()) / 3_600_000;
    const naBaseAgora = horas <= 2 && s.saindo.length ? `Na base agora está ${doutores(s.saindo)}, do turno anterior.` : "";
    const desativadaAgora = horas <= 12 && s.desativada ? `Agora a ${baseCode} está desativada no quadro dos médicos${s.desativada.desde ? ` desde ${s.desativada.desde}` : ""}.` : "";
    return [
      `${baseCode}, ${quando(turno.date, turno.period)}:`,
      escala ?? "Não consegui ver a escala médica desse turno.",
      desativadaAgora,
      naBaseAgora,
      `Perto das ${horaDoInicio(turno)} do dia, pergunte de novo: aí eu vejo quem chegou de fato.`,
    ].filter(Boolean).join(" ");
  }
  const inicio = horaDoInicio(turno);
  const tolerancia = horaDaTolerancia(turno);
  const comoRemanejar = `no card do plantão (aba Hoje) toque em Avisar → Sem médico; depois disso, na aba Check-in, escolha outra base livre`;

  if (!s.consultado) {
    return `Não consegui ver agora o quadro dos médicos. Se você chegar na ${baseCode} e não tiver médico até ${tolerancia}: ${comoRemanejar}.`;
  }
  if (s.desativada) {
    const desde = s.desativada.desde ? ` desde ${s.desativada.desde}` : "";
    const motivo = s.desativada.motivo ? ` (${s.desativada.motivo})` : "";
    return `A ${baseCode} está desativada no quadro dos médicos${desde}${motivo}. Não vai ativar por agora: ${comoRemanejar}.`;
  }
  if (s.chegaram.length) {
    return `Sim: ${doutores(s.chegaram)} já chegou na ${baseCode} (às ${s.chegaram[0].desde}) para o turno das ${inicio}. Procure por ${s.chegaram.length > 1 ? "eles" : "ele(a)"}.`;
  }
  const linhas = [
    `Ninguém do turno das ${inicio} registrou chegada na ${baseCode} ainda (o quadro só mostra quem registrou).`,
    ...(escala ? [escala] : []),
    s.saindo.length ? `Quem está de saída é ${doutores(s.saindo)}: procure por ele(a) e pergunte quem assume.` : "Também não há médico de saída na base.",
  ];
  const minutos = (now.getTime() - inicioDoTurno(turno).getTime()) / 60_000;
  linhas.push(minutos < REIVINDICACAO_MIN
    ? `Se ninguém chegar até ${tolerancia}: ${comoRemanejar}.`
    : `Já passou das ${tolerancia}: se está mesmo sem médico, ${comoRemanejar}.`);
  return linhas.join("\n");
}
