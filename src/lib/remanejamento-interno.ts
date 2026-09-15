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

/**
 * Bases fora do remanejamento: quem está escalado nelas não vê a grade, e elas
 * não aparecem para ninguém. LF90 (Lauro de Freitas) é outra cidade — não é
 * para onde alguém "passa" quando a base para, nem de onde alguém sai.
 */
const BASES_FORA = new Set(["LF90"]);

export function participaDoRemanejamento(baseCode: string): boolean {
  return !BASES_FORA.has(baseCode);
}

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

/**
 * O plantão começa às 07:00 (diurno) e 19:00 (noturno). A janela operacional
 * do app abre uma hora antes para o check-in, mas as tolerâncias daqui contam
 * do início real do turno.
 */
const INICIO_DO_TURNO = { DAY: 7, NIGHT: 19 } as const;

/** A grade só abre depois disto: tolerância para quem ainda vai chegar e fazer check-in, travando a própria vaga. */
export const ABERTURA_MIN = 10;
/** A partir daqui, escalado sem check-in continua visível, mas a vaga dele pode ser ocupada. */
export const REIVINDICACAO_MIN = 15;

export function minutosDesdeInicioDoTurno(period: "DAY" | "NIGHT", agora: { hour: number; minute: number }): number {
  const minutos = agora.hour * 60 + agora.minute - INICIO_DO_TURNO[period] * 60;
  // Noturno depois da meia-noite: o turno começou ontem.
  return minutos < 0 && period === "NIGHT" ? minutos + 24 * 60 : minutos;
}

export function horaDoTurno(period: "DAY" | "NIGHT", maisMinutos: number): string {
  return `${String(INICIO_DO_TURNO[period]).padStart(2, "0")}:${String(maisMinutos).padStart(2, "0")}`;
}

export type Ocupante = { faculdade: string; status: string; remanejado?: boolean };

export type Celula =
  | { tipo: "livre" }
  | {
      tipo: "ocupada";
      faculdade: string;
      estado: "sem-checkin" | "checkin-ok" | "saiu" | "remanejado";
      reivindicavel: boolean;
    }
  /** Lugar físico além da grade: só existe onde a grade tem menos que o limite físico. */
  | { tipo: "extra"; reservadaPara: string | null; ocupavel: boolean };

/**
 * A vaga além da grade. Base que só tem uma vaga na grade por estratégia ainda
 * cabe dois internos; a segunda é o "remanejamento humano", o que a
 * coordenação faria. `limite` é o limite físico do turno; `reservadaPara` é o
 * código da base irmã cujo interno tem prioridade; `podeUsar` diz se quem
 * está olhando pode ocupá-la agora (é o interno da irmã, ou a tolerância
 * passou e não há reserva).
 */
export type Extra = { limite: number; podeUsar: boolean; reservadaPara: string | null };

/**
 * As células de uma base no turno: quem está lá, depois as livres da grade,
 * depois a extra além da grade. Se a base está acima da grade, não sobra
 * célula livre — mas ninguém some.
 *
 * - bloqueada (aviso de problema neste turno, ou desativada no `plantoes`):
 *   não oferece nada; quem está lá continua visível.
 * - reivindicarSemCheckin (passada a tolerância): escalado que não fez check-in
 *   continua na célula, mas ela pode ser ocupada por quem procura vaga. Cada
 *   não-comparecimento libera **uma** vaga: quem chegou remanejado (ainda sem
 *   check-in aqui) já conta como presente, e enquanto houver célula livre a do
 *   sem check-in fica fechada — a livre vai primeiro.
 * - extra: aparece sempre que a grade é menor que o limite físico; é ocupável
 *   só enquanto o limite físico não estiver tomado por quem conta como
 *   presente e pelas células já oferecidas.
 */
export function celulasDaBase(
  capacity: number,
  ocupantes: Ocupante[],
  opts: { bloqueada?: boolean; reivindicarSemCheckin?: boolean; extra?: Extra } = {},
): Celula[] {
  const estadoDe = (o: Ocupante): Exclude<Celula, { tipo: "livre" | "extra" }>["estado"] =>
    o.status === "CHECKED_IN" ? "checkin-ok" : o.status === "CHECKED_OUT" ? "saiu" : o.remanejado ? "remanejado" : "sem-checkin";

  const livres = opts.bloqueada ? 0 : vagasNaGrade({ capacity, occupied: ocupantes.length });
  const presentes = ocupantes.filter((o) => estadoDe(o) !== "sem-checkin").length;
  // Antes da tolerância todo escalado segura o lugar; depois, só quem conta como presente.
  const contados = opts.reivindicarSemCheckin === true ? presentes : ocupantes.length;
  const reivindicaveis =
    !opts.bloqueada && opts.reivindicarSemCheckin === true && livres === 0 ? Math.max(0, capacity - presentes) : 0;

  let restantes = reivindicaveis;
  const ocupadas: Celula[] = ocupantes.map((o) => {
    const estado = estadoDe(o);
    const reivindicavel = estado === "sem-checkin" && restantes > 0;
    if (reivindicavel) restantes -= 1;
    return { tipo: "ocupada", faculdade: o.faculdade, estado, reivindicavel };
  });

  const extrasTotal = opts.extra && capacity > 0 ? Math.max(0, opts.extra.limite - capacity) : 0;
  const sobraFisica = opts.extra ? opts.extra.limite - contados - livres - reivindicaveis : 0;
  const extrasOcupaveis = opts.bloqueada || !opts.extra?.podeUsar ? 0 : Math.min(extrasTotal, Math.max(0, sobraFisica));
  const extras = Array.from({ length: extrasTotal }, (_, i): Celula => ({
    tipo: "extra",
    reservadaPara: opts.extra?.reservadaPara ?? null,
    ocupavel: i < extrasOcupaveis,
  }));

  return [...ocupadas, ...Array.from({ length: livres }, (): Celula => ({ tipo: "livre" })), ...extras];
}

export function celulaOcupavel(c: Celula): boolean {
  return c.tipo === "livre" || (c.tipo === "ocupada" ? c.reivindicavel : c.ocupavel);
}

/**
 * BR05/BR60 e PM04/PM40 são a mesma base física com duas viaturas: o cadastro
 * tem coordenadas idênticas. Quando uma para, o interno passa para a outra sem
 * sair do lugar — é a sugestão natural. Tolerância de ~10 m cobre arredondamento.
 */
export function mesmoEndereco(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): boolean {
  return Math.abs(a.latitude - b.latitude) < 1e-4 && Math.abs(a.longitude - b.longitude) < 1e-4;
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
