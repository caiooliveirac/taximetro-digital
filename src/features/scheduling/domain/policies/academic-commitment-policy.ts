/**
 * Agenda acadêmica da turma — a regra, sem banco.
 *
 * O líder lança, com antecedência, a prova ou atividade fixa da faculdade num
 * dia. O compromisso vira turnos bloqueados (data + turno), o mesmo par que o
 * resto da escala usa:
 *
 * 1. "Diurno", "Noturno" ou os dois no dia do compromisso.
 * 2. Noturno da véspera, opcional: o plantão noturno vai até 7h, e prova às 8h
 *    não deixa o interno sair do plantão direto para a sala.
 *
 * Efeito (ver academic-commitments.ts):
 * - os internos do compromisso ficam bloqueados nesses turnos em todo caminho
 *   que dá plantão: sorteio, alocação do líder, CRU fixo, vaga livre e extra;
 * - quem já estava escalado (plantão da grade, não iniciado) sai da escala;
 * - turma inteira: as vagas da grade do turno vão às outras faculdades como
 *   vaga liberada — exceto se outra turma da mesma faculdade cobre o dia
 *   (semana de virada), que segue podendo usar a vaga;
 * - parte da turma: ninguém cede vaga; o lugar de quem saiu fica para os
 *   colegas livres. Se a faculdade não for usar, o líder libera à mão.
 */

export type Periodo = "DAY" | "NIGHT";
export type TipoCompromisso = "PROVA" | "ATIVIDADE" | "AULA";

export const ROTULO_TIPO: Record<TipoCompromisso, string> = {
  PROVA: "Prova",
  ATIVIDADE: "Atividade fixa",
  AULA: "Aula",
};

export type CompromissoTurnos = {
  date: string;
  blocksDay: boolean;
  blocksNight: boolean;
  blocksEveNight: boolean;
};

export type Turno = { date: string; period: Periodo };

export function somaDias(dateStr: string, dias: number) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Turnos que o compromisso bloqueia, em ordem cronológica. */
export function turnosDoCompromisso(c: CompromissoTurnos): Turno[] {
  const turnos: Turno[] = [];
  if (c.blocksEveNight) turnos.push({ date: somaDias(c.date, -1), period: "NIGHT" });
  if (c.blocksDay) turnos.push({ date: c.date, period: "DAY" });
  if (c.blocksNight) turnos.push({ date: c.date, period: "NIGHT" });
  return turnos;
}

export function chaveDoTurno(t: Turno) {
  return `${t.date}|${t.period}`;
}

/**
 * Por que o compromisso não pode ser salvo, ou null se pode.
 * `hoje` é a data local (YYYY-MM-DD) — turno de hoje ainda vale: quem já
 * começou o plantão não sai (só sai SCHEDULED/CONFIRMED sem check-in).
 */
export function motivoParaRecusar(params: {
  compromisso: CompromissoTurnos;
  turma: { startDate: string; endDate: string };
  hoje: string;
}): string | null {
  const { compromisso: c, turma, hoje } = params;
  if (!c.blocksDay && !c.blocksNight) return "Escolha o turno do compromisso";
  if (c.date < turma.startDate || c.date > turma.endDate) {
    return "A data está fora do período da turma";
  }
  if (turnosDoCompromisso(c).some((t) => t.date < hoje)) {
    return "Não dá para lançar compromisso em data passada";
  }
  return null;
}

/**
 * A vaga da grade vai às outras faculdades? Só quando é a turma inteira e
 * nenhuma outra turma da faculdade está no rodízio nesse dia.
 */
export function cedeVagasDaGrade(params: {
  turmaInteira: boolean;
  date: string;
  outrasTurmas: Array<{ startDate: string; endDate: string }>;
}) {
  if (!params.turmaInteira) return false;
  return !params.outrasTurmas.some((t) => t.startDate <= params.date && t.endDate >= params.date);
}

/** Frase para a recusa em qualquer caminho de escala. */
export function mensagemDeBloqueio(quem: string, titulo: string, t: Turno) {
  const dia = `${t.date.slice(8, 10)}/${t.date.slice(5, 7)}`;
  const turno = t.period === "DAY" ? "diurno" : "noturno";
  return `${quem} tem ${titulo} no ${turno} de ${dia} (agenda da turma).`;
}
