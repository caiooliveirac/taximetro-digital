/**
 * "Estou na base tal, vai ativar?" — resposta pronta, sem modelo, a partir do
 * quadro de médicos do `plantoes` (situacaoDoTurnoNaBase). Puro, para teste.
 *
 * Quem procurar: o médico que chegou para o turno; se ninguém chegou, o que
 * está de saída (ele sabe quem assume). Sem médico depois da tolerância, o
 * caminho é o aviso "Sem médico" e o remanejamento pela aba Check-in
 * (remanejamento-interno.ts).
 */

import { REIVINDICACAO_MIN } from "@/lib/remanejamento-interno";
import { ativos, type MeuPlantao } from "@/lib/luna-inteligencia";
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

/**
 * Base e turno da pergunta: a base citada, ou a do plantão dele em andamento
 * ou que começa nas próximas 4h. O turno é o dele naquela base, senão o do
 * relógio.
 */
export function baseETurno(meus: MeuPlantao[], now: Date, citada: string | null): { baseCode: string | null; turno: Turno } {
  const perto = ativos(meus)
    .map((m) => ({ m, inicio: inicioDoTurno({ date: m.date, period: m.period }).getTime() }))
    .filter(({ inicio }) => inicio - now.getTime() <= 4 * 3_600_000 && now.getTime() - inicio <= 12 * 3_600_000)
    .sort((a, b) => Math.abs(a.inicio - now.getTime()) - Math.abs(b.inicio - now.getTime()));
  const meu = citada ? perto.find(({ m }) => m.baseCode === citada) : perto[0];
  if (meu) return { baseCode: meu.m.baseCode, turno: { date: meu.m.date, period: meu.m.period } };
  return { baseCode: citada, turno: turnoDoRelogio(now) };
}

const doutores = (l: { nome: string }[]) => `Dr(a). ${l.map((x) => x.nome).join(" e ")}`;

export function textoDaBaseAgora(p: { baseCode: string; turno: Turno; now: Date; situacao: SituacaoDoTurno }): string {
  const { baseCode, turno, now, situacao: s } = p;
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
  const naBase = s.saindo.length ? `Na base agora está ${doutores(s.saindo)}, do turno anterior (de saída).` : "";
  if (now < inicioDoTurno(turno)) {
    return [`O turno das ${inicio} na ${baseCode} ainda não começou e o médico dele ainda não registrou chegada.`, naBase, `Pergunte de novo perto das ${inicio}.`].filter(Boolean).join(" ");
  }
  const linhas = [
    `Ninguém do turno das ${inicio} registrou chegada na ${baseCode} ainda (o quadro só mostra quem registrou).`,
    s.saindo.length ? `Quem está de saída é ${doutores(s.saindo)}: procure por ele(a) e pergunte quem assume.` : "Também não há médico de saída na base.",
  ];
  const minutos = (now.getTime() - inicioDoTurno(turno).getTime()) / 60_000;
  linhas.push(minutos < REIVINDICACAO_MIN
    ? `Se ninguém chegar até ${tolerancia}: ${comoRemanejar}.`
    : `Já passou das ${tolerancia}: se está mesmo sem médico, ${comoRemanejar}.`);
  return linhas.join("\n");
}
