/**
 * Fita de turnos — o calendário do interno desenhado como a regra de
 * descanso enxerga o tempo: uma sequência contínua de turnos de 12h
 * (noite de ontem → dia de hoje → noite de hoje → dia de amanhã).
 *
 * Cada dia vira uma linha com duas faixas, diurno e noturno. Lida como texto,
 * a noite de um dia termina e a linha seguinte começa com o dia seguinte — o
 * turno colado fica literalmente ao lado. Os turnos colados num plantão ficam
 * marcados como descanso, com a mesma vizinhança de `rest-policy.ts`.
 */
import { turnosColados } from "@/shared/domain/policies/rest-policy";

export type TurnoDaFita = "DAY" | "NIGHT";

type PlantaoBase = {
  date: string;
  period: TurnoDaFita;
  shift?: string | null;
};

export type FaixaDaFita<T extends PlantaoBase> = {
  plantoes: T[];
  /** Plantão que deixa esta faixa sem 12h de descanso, se a faixa está vazia. */
  descansoDe: T | null;
};

export type DiaDaFita<T extends PlantaoBase> = {
  date: string;
  dia: FaixaDaFita<T>;
  noite: FaixaDaFita<T>;
};

export type SemanaDaFita<T extends PlantaoBase> = { inicio: string; dias: DiaDaFita<T>[] };

function somarDias(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de `date`. */
export function segundaDaSemana(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(date, dow === 0 ? -6 : 1 - dow);
}

const chave = (date: string, period: TurnoDaFita) => `${date}|${period}`;

/**
 * Semanas inteiras (segunda a domingo) do primeiro ao último plantão, cada
 * turno com seus plantões e, se vazio, o plantão que o fecha por descanso.
 *
 * Meio turno do EBMSP (`shift` preenchido) não fecha vizinho, igual à regra
 * de descanso: manhã + tarde no mesmo dia é um plantão de 12h, não dois.
 */
export function montarFita<T extends PlantaoBase>(plantoes: T[]): SemanaDaFita<T>[] {
  if (plantoes.length === 0) return [];

  const porTurno = new Map<string, T[]>();
  for (const p of plantoes) {
    const k = chave(p.date.slice(0, 10), p.period);
    porTurno.set(k, [...(porTurno.get(k) ?? []), p]);
  }

  const descanso = new Map<string, T>();
  for (const p of plantoes) {
    if (p.shift) continue;
    for (const vizinho of turnosColados({ date: p.date.slice(0, 10), period: p.period })) {
      if (!porTurno.has(vizinho) && !descanso.has(vizinho)) descanso.set(vizinho, p);
    }
  }

  const datas = plantoes.map((p) => p.date.slice(0, 10)).sort();
  const inicio = segundaDaSemana(datas[0]);
  const fim = somarDias(segundaDaSemana(datas[datas.length - 1]), 6);

  const faixa = (date: string, period: TurnoDaFita): FaixaDaFita<T> => {
    const k = chave(date, period);
    const doTurno = porTurno.get(k) ?? [];
    return { plantoes: doTurno, descansoDe: doTurno.length ? null : descanso.get(k) ?? null };
  };

  const semanas: SemanaDaFita<T>[] = [];
  for (let segunda = inicio; segunda <= fim; segunda = somarDias(segunda, 7)) {
    const dias: DiaDaFita<T>[] = [];
    for (let i = 0; i < 7; i++) {
      const date = somarDias(segunda, i);
      dias.push({ date, dia: faixa(date, "DAY"), noite: faixa(date, "NIGHT") });
    }
    semanas.push({ inicio: segunda, dias });
  }
  return semanas;
}
