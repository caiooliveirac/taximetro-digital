/**
 * Remanejamento pelo próprio interno.
 *
 * Ele avisou "sem médico" (ou enfermeiro, ou viatura) e a base está parada. Em
 * vez de esperar a coordenação acordar, ele vê a grade de hoje inteira — base
 * por base, célula por vaga — e se move sozinho para uma célula livre; a
 * coordenação é só avisada, pelo mesmo canal do aviso.
 *
 * Vaga aqui é vaga **de grade**, não o limite físico: `slot_rules.capacity`
 * somada de todas as faculdades da base naquele dia/turno menos quem já está
 * lá. Uma base com 2 vagas e 1 interno tem 1; com 1 vaga e 1 interno tem 0,
 * mesmo que fisicamente caiba mais um. De qual faculdade era o slot não
 * importa: vaga vazia é vaga vazia.
 */

import { TIPOS_DE_AVISO, type TipoDeAviso } from "@/lib/aviso-tom";

export function vagasNaGrade(load: { capacity: number; occupied: number }): number {
  return Math.max(0, load.capacity - load.occupied);
}

/**
 * Ordem canônica das bases: pelo número do código (SM01, CB02, PR03, PM04,
 * BR05, CN10...). Código sem número vai para o fim, em ordem alfabética.
 */
export function compararCodigoDeBase(a: string, b: string): number {
  const na = Number(a.replace(/\D/g, "")) || Infinity;
  const nb = Number(b.replace(/\D/g, "")) || Infinity;
  return na !== nb ? na - nb : a.localeCompare(b);
}

export type Ocupante = { faculdade: string; status: string };

export type Celula =
  | { tipo: "livre" }
  | { tipo: "ocupada"; faculdade: string; estado: "sem-checkin" | "checkin-ok" | "saiu" };

/**
 * As células de uma base no turno: primeiro quem está lá (check-in feito em
 * vermelho, ainda sem check-in em cor fraca), depois as livres. Se a base está
 * acima da grade, não sobra célula livre — mas ninguém some.
 */
export function celulasDaBase(capacity: number, ocupantes: Ocupante[]): Celula[] {
  const ocupadas: Celula[] = ocupantes.map((o) => ({
    tipo: "ocupada",
    faculdade: o.faculdade,
    estado: o.status === "CHECKED_IN" ? "checkin-ok" : o.status === "CHECKED_OUT" ? "saiu" : "sem-checkin",
  }));
  const livres = vagasNaGrade({ capacity, occupied: ocupantes.length });
  return [...ocupadas, ...Array.from({ length: livres }, (): Celula => ({ tipo: "livre" }))];
}

export function motivoDoRemanejamento(tipo: string | null | undefined): string {
  return tipo && tipo in TIPOS_DE_AVISO ? TIPOS_DE_AVISO[tipo as TipoDeAviso] : "a pedido do interno";
}

export function textoDoRemanejamento(p: {
  interno: string;
  faculdade: string | null;
  de: string;
  para: string;
  hora: string;
  motivo: string;
}): string {
  const quem = p.faculdade ? `*${p.interno}* (${p.faculdade})` : `*${p.interno}*`;
  return `🔁 ${quem} saiu da ${p.de} para a ${p.para} às ${p.hora}: ${p.motivo}.`;
}
