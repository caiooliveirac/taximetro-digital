/**
 * Remanejamento pelo próprio interno.
 *
 * Ele avisou "sem médico" (ou enfermeiro, ou viatura) e a base está parada. Em
 * vez de esperar a coordenação acordar, ele vê onde há vaga na grade de hoje e
 * se move sozinho; a coordenação é só avisada, pelo mesmo canal do aviso.
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
