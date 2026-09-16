/**
 * Plantão ao vivo: o turno em andamento visto pela coordenação.
 *
 * O interno avisa "sem médico" e se move sozinho (ver remanejamento-interno.ts).
 * A coordenação precisa da outra ponta: ver o turno inteiro, base por base, e
 * intervir do celular — arrastar um interno de uma base para outra, derrubar
 * um aviso falso, parar uma base que de fato parou, e, quando já não há vaga
 * em lugar nenhum, liberar o interno para repor em outro dia.
 *
 * Tudo que a coordenação faz sobre o turno é evento no `audit_log`, como o
 * aviso do interno já é: não há tabela nova, e o estado de cada base é a
 * dobra desses eventos em ordem. Este arquivo tem só a parte pura — a dobra,
 * as marcas e os textos — para ser testável sem banco.
 */

import { TIPOS_DE_AVISO, type TipoDeAviso } from "@/lib/aviso-tom";

/** Ações gravadas no audit_log que compõem o estado do turno. */
export const ACAO = {
  aviso: "INTERN_ALERT_SENT",
  avisoCancelado: "INTERN_ALERT_DISMISSED",
  baseParada: "BASE_SHIFT_CLOSED",
  baseReaberta: "BASE_SHIFT_REOPENED",
  liberadoParaRepor: "ASSIGNMENT_RELEASED_FOR_MAKEUP",
  reposicaoDesfeita: "ASSIGNMENT_MAKEUP_UNDONE",
} as const;

export const ACOES_DO_TURNO = [ACAO.aviso, ACAO.avisoCancelado, ACAO.baseParada, ACAO.baseReaberta] as const;

/** Um evento do turno, já em ordem cronológica. `hora` é HH:MM como foi gravada. */
export type EventoDoTurno =
  | { tipo: "AVISO"; baseId: string; assignmentId: string | null; interno: string | null; codigo: string | null; hora: string }
  | { tipo: "AVISO_CANCELADO"; baseId: string; hora: string }
  | { tipo: "PARADA"; baseId: string; motivo: string | null; hora: string }
  | { tipo: "REABERTA"; baseId: string; hora: string };

export type AvisoAtivo = {
  assignmentId: string | null;
  interno: string | null;
  /** Código do aviso (SEM_MEDICO...), ou null se não reconhecido. */
  codigo: TipoDeAviso | null;
  /** Texto do aviso, para a tela. */
  tipo: string;
  hora: string;
};

export type EstadoDaBase = {
  /** Avisos ainda de pé nesta base, do mais antigo ao mais novo. Cancelamento pela coordenação zera. */
  avisos: AvisoAtivo[];
  /** A coordenação parou a base neste turno e ainda não reabriu. */
  parada: { desde: string; motivo: string | null } | null;
};

export function rotuloDoAviso(codigo: string | null | undefined): string {
  return codigo && codigo in TIPOS_DE_AVISO ? TIPOS_DE_AVISO[codigo as TipoDeAviso] : "problema na base";
}

/**
 * Dobra os eventos do turno no estado de cada base. A ordem é a do relógio:
 * um aviso depois do cancelamento volta a valer, uma parada depois da
 * reabertura para de novo. É o que faz "cancelar um aviso falso" ser
 * reversível pelo próprio interno, apertando o botão outra vez.
 */
export function estadoDoTurno(eventos: EventoDoTurno[]): Map<string, EstadoDaBase> {
  const estado = new Map<string, EstadoDaBase>();
  const da = (baseId: string): EstadoDaBase => {
    let e = estado.get(baseId);
    if (!e) {
      e = { avisos: [], parada: null };
      estado.set(baseId, e);
    }
    return e;
  };
  for (const ev of eventos) {
    const base = da(ev.baseId);
    if (ev.tipo === "AVISO") {
      const codigo = ev.codigo && ev.codigo in TIPOS_DE_AVISO ? (ev.codigo as TipoDeAviso) : null;
      base.avisos.push({ assignmentId: ev.assignmentId, interno: ev.interno, codigo, tipo: rotuloDoAviso(ev.codigo), hora: ev.hora });
    } else if (ev.tipo === "AVISO_CANCELADO") {
      base.avisos = [];
    } else if (ev.tipo === "PARADA") {
      base.parada = { desde: ev.hora, motivo: ev.motivo?.trim() || null };
    } else {
      base.parada = null;
    }
  }
  return estado;
}

/** O aviso mais recente de pé na base, ou null. */
export function avisoDaBase(estado: EstadoDaBase | undefined): AvisoAtivo | null {
  return estado && estado.avisos.length > 0 ? estado.avisos[estado.avisos.length - 1] : null;
}

/**
 * O aviso de pé deste plantão, ou null: é o gatilho do remanejamento pelo
 * interno. Cancelado pela coordenação, o interno perde a grade — a coordenação
 * disse que a base está funcionando.
 */
export function avisoDoPlantao(estado: Map<string, EstadoDaBase>, assignmentId: string): AvisoAtivo | null {
  for (const base of estado.values()) {
    for (let i = base.avisos.length - 1; i >= 0; i--) {
      if (base.avisos[i].assignmentId === assignmentId) return base.avisos[i];
    }
  }
  return null;
}

/**
 * A marca na nota do plantão liberado para reposição. O `[REPOR]` é o que a
 * tela do interno e a lista de liberados leem; o resto é para gente.
 */
export const MARCA_REPOR = "[REPOR]";

export function notaDeReposicao(p: { baseCode: string; hora: string; motivo?: string | null }): string {
  const motivo = p.motivo?.trim() ? `: ${p.motivo.trim()}` : "";
  return `${MARCA_REPOR} ${p.baseCode} parada${motivo}. Liberado pela coordenação às ${p.hora} para repor em outro dia.`;
}

export function ehReposicao(notes: string | null | undefined): boolean {
  return Boolean(notes && notes.includes(MARCA_REPOR));
}

/** Tira a linha da reposição da nota, para o desfazer. */
export function semNotaDeReposicao(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const restante = notes
    .split("\n")
    .filter((linha) => !linha.includes(MARCA_REPOR))
    .join("\n")
    .trim();
  return restante || null;
}

/** HH:MM da nota de reposição, para a lista de liberados. */
export function horaDaReposicao(notes: string | null | undefined): string | null {
  return notes?.match(/às (\d{2}:\d{2}) para repor/)?.[1] ?? null;
}

/** Mensagens para o interno, no Telegram. */
export function textoParaInternoRemanejado(p: { de: string; para: string; nomeDaBase: string; motivo: string | null }): string {
  const motivo = p.motivo ? ` (${p.motivo})` : "";
  return `📍 A coordenação te remanejou da ${p.de} para a ${p.para} — ${p.nomeDaBase}${motivo}. Se ainda não fez check-in, faça lá.`;
}

export function textoParaInternoRepor(p: { baseCode: string; motivo: string | null }): string {
  const motivo = p.motivo ? ` (${p.motivo})` : "";
  return `🗓️ Seu plantão de hoje na ${p.baseCode} foi liberado pela coordenação: a base parou${motivo} e não há vaga em outra. Não conta como falta. Reponha em outro dia — as vagas abertas aparecem no app.`;
}

export function textoParaInternoReposicaoDesfeita(p: { baseCode: string }): string {
  return `↩️ A coordenação desfez a liberação: seu plantão de hoje na ${p.baseCode} voltou a valer.`;
}
