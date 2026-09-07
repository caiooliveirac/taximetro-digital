import { operationalDateStr } from "@/lib/utils";

export type VelocimeterData = {
  completed: number;
  /** Agendados que ainda podem virar realizados (hoje inclusive). */
  scheduled?: number;
  target: number;
  rotationStartDate: string | null;
  rotationEndDate: string | null;
};

export type VelocimeterStatus = "ok" | "atencao" | "critico" | "concluido" | "neutro";

type Variant = "compact" | "inline" | "card";

type Computed = {
  status: VelocimeterStatus;
  pct: number;
  /** (realizados + agendados) / meta — a projeção, teto 100. */
  projectedPct: number;
  ritmoAtual: number;
  ritmoNecessario: number | null;
  weeksRemaining: number;
  weeksElapsed: number;
  restante: number;
  /** Quanto ainda falta AGENDAR para a conta fechar. 0 = já fecha. */
  faltaAgendar: number;
  message?: string;
};

const AMBER_THRESHOLD = 1.15;

function daysBetween(from: string, to: string): number {
  const f = new Date(`${from}T12:00:00Z`).getTime();
  const t = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((t - f) / 86_400_000);
}

export function computeVelocimeter(data: VelocimeterData): Computed {
  const today = operationalDateStr();
  const { completed, target, rotationStartDate, rotationEndDate } = data;
  const scheduled = data.scheduled ?? 0;
  const pct = target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0;
  const projectedPct = target > 0 ? Math.min(100, Math.round(((completed + scheduled) / target) * 100)) : 0;
  const restante = Math.max(0, target - completed);
  // O que o coordenador quer ver: com o que já está na agenda, a conta fecha?
  const faltaAgendar = Math.max(0, restante - scheduled);

  if (target === 0) {
    return { status: "neutro", pct: 0, projectedPct: 0, ritmoAtual: 0, ritmoNecessario: null, weeksRemaining: 0, weeksElapsed: 0, restante: 0, faltaAgendar: 0, message: "Sem meta configurada" };
  }
  if (completed >= target) {
    return { status: "concluido", pct: 100, projectedPct: 100, ritmoAtual: 0, ritmoNecessario: 0, weeksRemaining: 0, weeksElapsed: 0, restante: 0, faltaAgendar: 0, message: "Meta atingida" };
  }
  if (!rotationStartDate || !rotationEndDate) {
    return { status: "neutro", pct, projectedPct, ritmoAtual: 0, ritmoNecessario: null, weeksRemaining: 0, weeksElapsed: 0, restante, faltaAgendar, message: "Sem turma vinculada" };
  }

  const daysElapsedRaw = daysBetween(rotationStartDate, today);
  const daysRemainingRaw = daysBetween(today, rotationEndDate);
  const daysElapsed = Math.max(1, daysElapsedRaw);
  const daysRemaining = Math.max(0, daysRemainingRaw);

  const weeksElapsed = daysElapsed / 7;
  const weeksRemaining = daysRemaining / 7;
  const ritmoAtual = completed / weeksElapsed;

  if (daysRemaining === 0) {
    return { status: "critico", pct, projectedPct, ritmoAtual, ritmoNecessario: Infinity, weeksRemaining: 0, weeksElapsed, restante, faltaAgendar, message: "Rotação encerrada com déficit" };
  }

  const ritmoNecessario = restante / weeksRemaining;
  // Ritmo nominal da rotação: a meta direta rateada pelas semanas que a
  // rotação tem. Substituiu a meta semanal por faculdade, que saiu do produto.
  const ritmoNominal = target / Math.max(1, weeksElapsed + weeksRemaining);
  const cabe = weeksRemaining * ritmoNominal >= restante;

  let status: VelocimeterStatus;
  // Agenda já cobre o que falta: verde, mesmo com ritmo passado abaixo da meta.
  if (faltaAgendar === 0) status = "ok";
  else if (!cabe) status = "critico";
  else if (ritmoNecessario > ritmoAtual * AMBER_THRESHOLD) status = "atencao";
  else status = "ok";

  return { status, pct, projectedPct, ritmoAtual, ritmoNecessario, weeksRemaining, weeksElapsed, restante, faltaAgendar };
}

const STATUS_STYLE: Record<VelocimeterStatus, { pillBg: string; pillText: string; bar: string; barTrack: string; label: string }> = {
  ok: { pillBg: "bg-emerald-50 ring-emerald-200", pillText: "text-emerald-700", bar: "bg-emerald-500", barTrack: "bg-emerald-100", label: "No ritmo" },
  atencao: { pillBg: "bg-amber-50 ring-amber-200", pillText: "text-amber-700", bar: "bg-amber-500", barTrack: "bg-amber-100", label: "Acelerar" },
  critico: { pillBg: "bg-red-50 ring-red-200", pillText: "text-red-700", bar: "bg-red-500", barTrack: "bg-red-100", label: "Crítico" },
  concluido: { pillBg: "bg-emerald-50 ring-emerald-200", pillText: "text-emerald-700", bar: "bg-emerald-500", barTrack: "bg-emerald-100", label: "Concluído" },
  neutro: { pillBg: "bg-slate-50 ring-slate-200", pillText: "text-slate-600", bar: "bg-slate-400", barTrack: "bg-slate-100", label: "—" },
};

function formatRitmo(v: number): string {
  if (!isFinite(v)) return "∞";
  if (v >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

export function VelocimeterCard({ data, variant = "card" }: { data: VelocimeterData; variant?: Variant }) {
  const c = computeVelocimeter(data);
  const s = STATUS_STYLE[c.status];
  const scheduled = data.scheduled ?? 0;

  if (data.target === 0) return null;

  if (variant === "compact") {
    return (
      <span className="inline-flex items-center gap-2 text-xs tabular-nums">
        <span className={`inline-flex h-1.5 w-1.5 rounded-full ${s.bar}`} />
        <span className="font-semibold text-slate-800">{data.completed}/{data.target}</span>
        {scheduled > 0 && (
          <span className="text-[10px] text-slate-500">+{scheduled} agendado{scheduled > 1 ? "s" : ""}</span>
        )}
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${s.pillBg} ${s.pillText}`}>
          {s.label}
        </span>
      </span>
    );
  }

  if (variant === "inline") {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800 tabular-nums">
            {data.completed}/{data.target} plantões
            {scheduled > 0 && <span className="ml-1 font-normal text-slate-500">+{scheduled} agendado{scheduled > 1 ? "s" : ""}</span>}
          </span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${s.pillBg} ${s.pillText}`}>
            {s.label}
          </span>
        </div>
        <div className={`relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full ${s.barTrack}`}>
          <div className={`absolute inset-y-0 left-0 ${s.bar} opacity-30`} style={{ width: `${c.projectedPct}%` }} />
          <div className={`absolute inset-y-0 left-0 ${s.bar} transition-all`} style={{ width: `${c.pct}%` }} />
        </div>
        {c.message ? (
          <p className="mt-1 text-[11px] text-slate-500">{c.message}</p>
        ) : c.ritmoNecessario !== null && isFinite(c.ritmoNecessario) ? (
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
            atual <span className="font-medium text-slate-700">{formatRitmo(c.ritmoAtual)}/sem</span>
            {" · "}
            meta <span className="font-medium text-slate-700">{formatRitmo(c.ritmoNecessario)}/sem</span>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Andamento da rotação</p>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${s.pillBg} ${s.pillText}`}>
          {s.label}
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-slate-900 tabular-nums">{data.completed}<span className="text-slate-400">/{data.target}</span></span>
          <span className="text-sm text-slate-500 tabular-nums">{c.pct}%</span>
        </div>
        {c.restante > 0 && (
          <span className="text-xs text-slate-500 tabular-nums">
            faltam {c.restante}
            {scheduled > 0 && <span className="text-slate-400"> · {scheduled} agendado{scheduled > 1 ? "s" : ""}</span>}
          </span>
        )}
      </div>

      {/* faixa clara = projeção com os agendados; faixa cheia = já realizado */}
      <div className={`relative mt-2 h-2 w-full overflow-hidden rounded-full ${s.barTrack}`}>
        <div className={`absolute inset-y-0 left-0 ${s.bar} opacity-30`} style={{ width: `${c.projectedPct}%` }} />
        <div className={`absolute inset-y-0 left-0 ${s.bar} transition-all`} style={{ width: `${c.pct}%` }} />
      </div>

      {c.message && (
        <p className="mt-3 text-xs text-slate-500">{c.message}</p>
      )}

      {!c.message && c.ritmoNecessario !== null && isFinite(c.ritmoNecessario) && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="ritmo atual" value={`${formatRitmo(c.ritmoAtual)}/sem`} />
          <Stat label="ritmo necess." value={`${formatRitmo(c.ritmoNecessario)}/sem`} highlight={c.status === "atencao" || c.status === "critico"} />
          <Stat label="semanas rest." value={c.weeksRemaining < 1 ? "<1" : `${Math.round(c.weeksRemaining)}`} />
          <Stat label="falta agendar" value={`${c.faltaAgendar}`} highlight={c.faltaAgendar > 0} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${highlight ? "text-amber-700" : "text-slate-800"}`}>{value}</p>
    </div>
  );
}
