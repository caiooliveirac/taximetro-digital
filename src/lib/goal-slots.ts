/**
 * Casinhas da meta.
 *
 * A meta da faculdade é direta: N USA, N CRU, N CRL. Cada plantão da rotação
 * ocupa uma casinha do seu tipo; o que sobra da meta vira casinha vazia com
 * alerta. É a mesma conta na tela do interno, na do líder e na do coordenador —
 * o interno vê que não vai fechar a carga horária antes de a rotação acabar, e
 * quem escala vê onde intervir.
 *
 * Falta (ABSENT) aparece como casinha perdida e NÃO ocupa vaga da meta: quem
 * faltou continua devendo aquele plantão. Falta abonada (EXCUSED) conta, que é
 * o que o abono significa.
 */

export const GOAL_KINDS = ["USA", "CRU", "CRL"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export type GoalTargets = Record<GoalKind, number>;

/**
 * - done: realizado (ou abonado)
 * - pending: já passou e não foi realizado nem marcado como falta — vale como
 *   plantão cumprido para a meta, mas o checkout está pendurado
 * - scheduled: ainda vai acontecer
 * - missed: falta; não ocupa vaga da meta
 * - empty: vaga da meta que ninguém escalou ainda
 */
export type GoalSlotState = "done" | "pending" | "scheduled" | "missed" | "empty";

export type GoalSlotItem = {
  id: string;
  date: string;
  status: string;
  baseType?: string | null;
  /** Plantão extra não conta para a meta — mesma regra do compliance. */
  isExtraShift?: boolean | null;
};

export type GoalSlot<T extends GoalSlotItem> = {
  key: string;
  kind: GoalKind;
  state: GoalSlotState;
  assignment: T | null;
};

export type GoalKindSummary<T extends GoalSlotItem = GoalSlotItem> = {
  kind: GoalKind;
  target: number;
  /** Casinhas que contam para a meta (realizadas, pendentes ou agendadas). */
  filled: number;
  /** Casinhas realizadas ou já ocorridas. */
  done: number;
  /** Casinhas agendadas no futuro. */
  scheduled: number;
  /** Faltas — não contam para a meta. */
  missed: number;
  /** Vagas da meta sem plantão nenhum. */
  missing: number;
  slots: GoalSlot<T>[];
};

const REALIZED = new Set(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "EXCUSED"]);

export function goalKindOf(baseType: string | null | undefined): GoalKind | null {
  if (baseType === "USA") return "USA";
  if (baseType === "CENTRAL") return "CRU";
  if (baseType === "CRL") return "CRL";
  return null;
}

function stateOf(item: GoalSlotItem, today: string): Exclude<GoalSlotState, "empty"> {
  if (item.status === "ABSENT") return "missed";
  if (REALIZED.has(item.status)) return "done";
  return item.date <= today ? "pending" : "scheduled";
}

/**
 * Monta as casinhas de um tipo: os plantões existentes em ordem de data, e
 * depois as vagas da meta que ninguém preencheu.
 */
export function buildGoalSlots<T extends GoalSlotItem>(
  items: T[],
  kind: GoalKind,
  target: number,
  today: string,
): GoalSlot<T>[] {
  const mine = items
    .filter((i) => i.status !== "CANCELLED" && !i.isExtraShift && goalKindOf(i.baseType) === kind)
    .sort((a, b) => a.date.localeCompare(b.date));

  const slots: GoalSlot<T>[] = mine.map((assignment) => ({
    key: assignment.id,
    kind,
    state: stateOf(assignment, today),
    assignment,
  }));

  const counted = slots.filter((s) => s.state !== "missed").length;
  for (let i = counted; i < target; i++) {
    slots.push({ key: `${kind}-empty-${i}`, kind, state: "empty", assignment: null });
  }
  return slots;
}

export function summarizeGoals<T extends GoalSlotItem>(
  items: T[],
  targets: GoalTargets,
  today: string,
): GoalKindSummary<T>[] {
  return GOAL_KINDS.map((kind) => {
    const target = targets[kind] ?? 0;
    const slots = buildGoalSlots(items, kind, target, today);
    const count = (state: GoalSlotState) => slots.filter((s) => s.state === state).length;
    return {
      kind,
      target,
      filled: slots.filter((s) => s.state !== "missed" && s.state !== "empty").length,
      done: count("done") + count("pending"),
      scheduled: count("scheduled"),
      missed: count("missed"),
      missing: count("empty"),
      slots,
    };
  });
}

/** Total de vagas da meta sem plantão — o que o líder precisa escalar. */
export function totalMissingSlots(summaries: Array<Pick<GoalKindSummary, "missing">>): number {
  return summaries.reduce((acc, s) => acc + s.missing, 0);
}

/**
 * As casinhas quando só há contagem, sem os plantões em mãos — é o caso das
 * listas (escolher interno, cockpit do líder), que carregam o compliance de
 * todo mundo mas não a agenda de cada um. Mesma leitura da ficha: realizado,
 * agendado, e a vaga da meta que ninguém escalou.
 */
export type GoalCounts = {
  /** Realizados (ou abonados) já contabilizados. */
  done: number;
  /** Escalados na rotação, sem falta: realizados + o que ainda vai acontecer. */
  planned: number;
  /** Vagas da meta sem plantão nenhum. */
  missing: number;
};

export function slotStatesFromCounts(counts: GoalCounts): GoalSlotState[] {
  const done = Math.max(0, counts.done);
  const scheduled = Math.max(0, counts.planned - done);
  const missing = Math.max(0, counts.missing);
  return [
    ...Array<GoalSlotState>(done).fill("done"),
    ...Array<GoalSlotState>(scheduled).fill("scheduled"),
    ...Array<GoalSlotState>(missing).fill("empty"),
  ];
}
