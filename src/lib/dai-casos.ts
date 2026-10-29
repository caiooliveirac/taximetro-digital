/**
 * Casos do Dai: charadas clínicas com texto pronto, sem modelo. Vieram do
 * gatekeeper (bot do preceptor) em 2026-10-29; a partir daí o JSON daqui é a
 * fonte e é editado por PR. Ver docs/PLAN-dai-casos.md.
 *
 * O nome do caso entrega o diagnóstico ("De Winter Disfarçado"), então o
 * cartão fechado leva só tema, nível e estímulo; o resto sai depois que o
 * interno escreve a tentativa dele.
 */

import todos from "@/content/dai-casos.json";
import { TEMAS, rotuloDoTema, type Tema } from "@/lib/dai-temas";

export type Caso = {
  id: string;
  tema: string;
  nivel: number;
  nome: string;
  estimulo: string;
  armadilha: string;
  resposta: string;
  fechamento: string;
  referencia: string;
};

export type CasoFechado = Pick<Caso, "id" | "tema" | "nivel" | "estimulo"> & { rotulo: string };
export type CasoAberto = CasoFechado & Pick<Caso, "nome" | "armadilha" | "resposta" | "fechamento" | "referencia">;
export type TemaResumo = { tema: Tema; rotulo: string; total: number; vistos: number };

export const CASOS: readonly Caso[] = todos;

/** Tentativa mínima para abrir a resposta: o bastante para ter pensado. */
export const TENTATIVA_MIN = 40;

export const AUDIT_CASO_ABERTO = "DAI_CASO_ABERTO";

export const casoPorId = (id: string) => CASOS.find((c) => c.id === id) ?? null;

export const fechar = (c: Caso): CasoFechado => ({ id: c.id, tema: c.tema, nivel: c.nivel, estimulo: c.estimulo, rotulo: rotuloDoTema(c.tema) });

export const abrir = (c: Caso): CasoAberto => ({ ...fechar(c), nome: c.nome, armadilha: c.armadilha, resposta: c.resposta, fechamento: c.fechamento, referencia: c.referencia });

/**
 * Próximo caso do tema: o que o interno ainda não abriu, do nível mais baixo
 * para o mais alto; esgotou, o que ele abriu há mais tempo.
 * `abertos` = ids na ordem em que foram abertos (mais antigo primeiro).
 */
export function proximoCaso(tema: string, abertos: string[], pular?: string): Caso | null {
  const doTema = CASOS.filter((c) => c.tema === tema && c.id !== pular);
  const novo = doTema.find((c) => !abertos.includes(c.id));
  if (novo) return novo;
  const ultimaVez = (c: Caso) => abertos.lastIndexOf(c.id);
  return [...doTema].sort((a, b) => ultimaVez(a) - ultimaVez(b))[0] ?? null;
}

export function resumoDosTemas(abertos: string[]): TemaResumo[] {
  return TEMAS.map(({ tema, rotulo }) => {
    const doTema = CASOS.filter((c) => c.tema === tema);
    return { tema, rotulo, total: doTema.length, vistos: doTema.filter((c) => abertos.includes(c.id)).length };
  }).filter((t) => t.total > 0);
}
