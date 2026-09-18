/**
 * Descanso de 12h entre plantões — regra dura, fonte única.
 *
 * Os turnos são de 12h (DAY 7–19, NIGHT 19–7), então dois plantões em turnos
 * vizinhos são 24h seguidas. O sorteio já barra isso (`canAssign`); a troca
 * entre internos e a vaga liberada gravavam sem olhar, e foi assim que apareceu
 * gente com sexta noite + sábado dia + sábado noite.
 *
 * Meio turno do EBMSP (`shift` MORNING/AFTERNOON, 6h) não entra na conta de
 * vizinhança: manhã + tarde no mesmo dia é um plantão de 12h, não dois.
 */

export type TurnoDePlantao = {
  date: string; // "YYYY-MM-DD"
  period: "DAY" | "NIGHT";
  shift?: string | null;
  baseCode: string;
};

/** Turnos de 12h imediatamente antes e depois ("date|period"). */
export function turnosColados(pos: { date: string; period: "DAY" | "NIGHT" }): string[] {
  const outroDia = new Date(pos.date + "T12:00:00Z");
  outroDia.setUTCDate(outroDia.getUTCDate() + (pos.period === "DAY" ? -1 : 1));
  const vizinho = outroDia.toISOString().slice(0, 10);
  return pos.period === "DAY"
    ? [`${vizinho}|NIGHT`, `${pos.date}|NIGHT`]
    : [`${pos.date}|DAY`, `${vizinho}|DAY`];
}

/**
 * O plantão de `outros` que impede o interno de assumir `novo`: o mesmo turno,
 * ou um turno colado nele. `null` quando o descanso está garantido.
 */
export function plantaoSemDescanso(novo: TurnoDePlantao, outros: TurnoDePlantao[]): TurnoDePlantao | null {
  const colados = new Set(turnosColados(novo));
  for (const outro of outros) {
    const data = outro.date.slice(0, 10);
    if (data === novo.date && outro.period === novo.period) {
      const meiosTurnosDiferentes = Boolean(novo.shift && outro.shift && novo.shift !== outro.shift);
      if (!meiosTurnosDiferentes) return outro;
      continue;
    }
    if (novo.shift || outro.shift) continue;
    if (colados.has(`${data}|${outro.period}`)) return outro;
  }
  return null;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** "CB02 sáb 24/10 dia" */
export function descreveTurno(turno: TurnoDePlantao): string {
  const data = turno.date.slice(0, 10);
  const dia = DIAS[new Date(data + "T12:00:00Z").getUTCDay()];
  const [, mes, diaDoMes] = data.split("-");
  return `${turno.baseCode} ${dia} ${diaDoMes}/${mes} ${turno.period === "DAY" ? "dia" : "noite"}`;
}

export function mensagemSemDescanso(quem: string, novo: TurnoDePlantao, outro: TurnoDePlantao): string {
  const [primeiro, segundo] = [novo, outro].sort((a, b) =>
    `${a.date.slice(0, 10)}${a.period === "DAY" ? 0 : 1}`.localeCompare(`${b.date.slice(0, 10)}${b.period === "DAY" ? 0 : 1}`),
  );
  const mesmoTurno = novo.date === outro.date.slice(0, 10) && novo.period === outro.period;
  return mesmoTurno
    ? `${quem} já tem plantão nesse mesmo turno: ${descreveTurno(outro)}.`
    : `${quem} ficaria com dois plantões seguidos, sem 12h de descanso: ${descreveTurno(primeiro)} e ${descreveTurno(segundo)}.`;
}
