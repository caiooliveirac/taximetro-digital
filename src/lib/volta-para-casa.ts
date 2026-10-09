/**
 * Interno que não foi remanejado e continua escalado numa base que o chefe de
 * plantão desativou no `plantoes` ("mesa operacional"): voltou para casa.
 * Quem já saiu (CHECKED_OUT) não entra. Sem dependência de banco, para servir
 * ao bot das 09:00 e à seção da tela Plantão.
 */

export type BaseParaVolta = {
  code: string;
  name: string;
  desativada: { desde: string | null; motivo: string | null } | null;
  ocupantes: Array<{ interno: string; faculdade: string | null; status: string; assignmentId?: string }>;
};

export type VoltaParaCasa = {
  baseCode: string;
  baseName: string;
  desde: string | null;
  motivo: string | null;
  internos: Array<{ interno: string; faculdade: string | null; assignmentId?: string }>;
};

export function internosEmBaseDesativada(bases: BaseParaVolta[]): VoltaParaCasa[] {
  return bases
    .filter((b) => b.desativada)
    .map((b) => ({
      baseCode: b.code,
      baseName: b.name,
      desde: b.desativada?.desde ?? null,
      motivo: b.desativada?.motivo ?? null,
      internos: b.ocupantes
        .filter((o) => o.status !== "CHECKED_OUT")
        .map((o) => ({ interno: o.interno, faculdade: o.faculdade, assignmentId: o.assignmentId }))
        .sort((a, c) => a.interno.localeCompare(c.interno, "pt-BR")),
    }))
    .filter((g) => g.internos.length > 0);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** "2026-10-09" → "09/10". */
function diaMes(date: string) {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

export function mensagemVoltaParaCasa(grupos: VoltaParaCasa[], date: string): string {
  const total = grupos.reduce((n, g) => n + g.internos.length, 0);
  const linhas = [
    `🏠 <b>Voltam para casa · ${diaMes(date)} · diurno</b>`,
    "",
    `${total} interno(s) em base desativada, sem remanejamento.`,
  ];
  for (const g of grupos) {
    linhas.push("", `🔴 <b>${escapeHtml(g.baseCode)}</b> — ${escapeHtml(g.baseName)}`);
    const quando = [g.desde ? `desde ${escapeHtml(g.desde)}` : null, g.motivo ? escapeHtml(g.motivo) : null].filter(Boolean);
    if (quando.length > 0) linhas.push(`<i>${quando.join(" · ")}</i>`);
    for (const i of g.internos) linhas.push(`• ${escapeHtml(i.interno)}${i.faculdade ? ` (${escapeHtml(i.faculdade)})` : ""}`);
  }
  return linhas.join("\n");
}
