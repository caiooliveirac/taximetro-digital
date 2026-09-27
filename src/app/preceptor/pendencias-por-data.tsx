"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, LogIn, LogOut, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/table-skeleton";
import { AttendanceQuickActions } from "@/components/attendance-quick-actions";
import { baseViewIndex, getBaseStyleByCode, getFacultyStyle } from "@/lib/base-colors";
import { addDaysToDateStr, cn } from "@/lib/utils";
import { CheckoutNpsForm, type CheckoutNps } from "./checkout-nps-form";

/**
 * Checkout esquecido: o preceptor volta a uma data e vê só quem ficou sem
 * check-in ou sem checkout, em todas as bases e nos dois turnos. Quem fechou o
 * plantão ou foi abonado não aparece — a lista precisa ser curta.
 */

export const STRIP_DAYS = 14;

export type Pendencia = {
  id: string;
  internId: string;
  internName: string;
  facultyAbbr: string;
  baseCode: string;
  baseName: string;
  date: string;
  period: "DAY" | "NIGHT";
  shift: string | null;
  status: string;
  checkinAt: string | null;
  kind: "CHECKOUT" | "CHECKIN";
};

export async function fetchPendencias(from: string, to: string): Promise<Pendencia[]> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/taximetro/api/preceptor/pendencias?${params}`, { headers: { "x-force-role": "PRECEPTOR" } });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Erro ao carregar pendências");
  return json.data;
}

function utcNoon(dateStr: string) {
  return new Date(`${dateStr}T12:00:00Z`);
}

function shortWeekday(dateStr: string) {
  return utcNoon(dateStr).toLocaleDateString("pt-BR", { weekday: "short", timeZone: "UTC" }).replace(".", "");
}

function dayMonth(dateStr: string) {
  return utcNoon(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

function longDate(dateStr: string) {
  return utcNoon(dateStr).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function relativeLabel(dateStr: string, today: string) {
  if (dateStr === today) return "Hoje";
  if (dateStr === addDaysToDateStr(today, -1)) return "Ontem";
  return shortWeekday(dateStr);
}

function clockTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function shiftLabel(shift: string | null) {
  if (shift === "MORNING") return "Manhã";
  if (shift === "AFTERNOON") return "Tarde";
  return null;
}

/**
 * Três jeitos de chegar a uma data: a faixa dos últimos dias (com quantas
 * pendências cada um tem), as setas dia a dia e o calendário para qualquer data.
 * `selected === null` é o plantão atual (hoje e ontem, base declarada).
 */
export function DateNavigator({
  today,
  selected,
  counts,
  onSelect,
}: {
  today: string;
  selected: string | null;
  counts: Record<string, { checkout: number; checkin: number }>;
  onSelect: (date: string | null) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: STRIP_DAYS - 1 }, (_, i) => addDaysToDateStr(today, -(i + 1)));

  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>("[data-selected='true']");
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selected]);

  const prev = selected ? addDaysToDateStr(selected, -1) : addDaysToDateStr(today, -1);
  const next = selected && selected < today ? addDaysToDateStr(selected, 1) : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <Button type="button" size="icon" variant="outline" aria-label="Dia anterior" onClick={() => onSelect(prev)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold capitalize text-slate-900">
            {selected ? longDate(selected) : "Plantão atual"}
          </p>
          <p className="text-[11px] text-slate-500">
            {selected ? "Todas as bases · só quem está pendente" : "Hoje e ontem · sua base e turno"}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Dia seguinte"
          disabled={!next}
          onClick={() => next && onSelect(next)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div ref={stripRef} className="-mx-3 mt-3 flex snap-x gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
        <button
          type="button"
          data-selected={selected === null}
          onClick={() => onSelect(null)}
          className={cn(
            "flex min-w-[64px] snap-start flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-xs transition-colors",
            selected === null ? "border-accent-500 bg-accent-50 font-semibold text-accent-700" : "border-slate-200 text-slate-600",
          )}
        >
          <span>Agora</span>
          <span className="text-[10px] text-slate-400">plantão</span>
        </button>
        {days.map((d) => {
          const c = counts[d];
          const total = (c?.checkout ?? 0) + (c?.checkin ?? 0);
          const active = selected === d;
          return (
            <button
              key={d}
              type="button"
              data-selected={active}
              onClick={() => onSelect(d)}
              className={cn(
                "relative flex min-w-[56px] snap-start flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-xs capitalize transition-colors",
                active ? "border-accent-500 bg-accent-50 font-semibold text-accent-700" : "border-slate-200 text-slate-600",
              )}
            >
              <span>{relativeLabel(d, today)}</span>
              <span className="text-[10px] text-slate-400">{dayMonth(d)}</span>
              {total > 0 && (
                <span
                  className={cn(
                    "absolute -right-1 -top-1 min-w-[18px] rounded-full px-1 text-[10px] font-semibold leading-[18px] text-white",
                    c.checkout > 0 ? "bg-blue-600" : "bg-slate-400",
                  )}
                  title={`${c.checkout} sem checkout · ${c.checkin} sem check-in`}
                >
                  {total}
                </span>
              )}
            </button>
          );
        })}
        <label
          className="relative flex min-w-[64px] snap-start cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-600"
        >
          <CalendarDays className="h-4 w-4" strokeWidth={1.5} />
          <span className="text-[10px]">Outra data</span>
          <input
            type="date"
            max={today}
            value={selected ?? ""}
            onChange={(e) => { if (e.target.value && e.target.value <= today) onSelect(e.target.value); }}
            aria-label="Escolher data no calendário"
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

export function PendenciasDoDia({ date, onChanged }: { date: string; onChanged: () => void }) {
  const [rows, setRows] = useState<Pendencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [openCheckout, setOpenCheckout] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchPendencias(date, date));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro de conexão");
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    setMsg(null);
    setOpenCheckout(null);
    load();
  }, [load]);

  async function refresh() {
    await load();
    onChanged();
  }

  async function checkout(id: string, nps: CheckoutNps, notes: string) {
    setSubmitting(id);
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/attendance/checkout", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
        body: JSON.stringify({ assignmentId: id, nps, notes }),
      });
      const json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: "Checkout registrado." });
        setOpenCheckout(null);
        await refresh();
      } else {
        setMsg({ type: "error", text: json.error || "Não foi possível confirmar checkout." });
      }
    } catch {
      setMsg({ type: "error", text: "Erro de conexão. Tente novamente." });
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) return <TableSkeleton rows={4} cols={3} />;
  if (error) return <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>;

  const byBase = new Map<string, Pendencia[]>();
  for (const r of rows) {
    const list = byBase.get(r.baseCode) ?? [];
    list.push(r);
    byBase.set(r.baseCode, list);
  }
  const baseCodes = [...byBase.keys()].sort((a, b) => baseViewIndex(a) - baseViewIndex(b) || a.localeCompare(b));
  const checkoutCount = rows.filter((r) => r.kind === "CHECKOUT").length;

  return (
    <div className="space-y-4">
      {msg && (
        <div className={cn(
          "rounded-lg px-4 py-2.5 text-sm",
          msg.type === "success" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10" : "bg-red-50 text-red-700 ring-1 ring-red-600/10",
        )}>
          {msg.text}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white py-10 text-center text-sm text-slate-500">
          Nenhuma pendência neste dia.<br />
          <span className="text-xs text-slate-400">Todos os internos escalados fizeram check-in e checkout ou foram abonados.</span>
        </p>
      ) : (
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-blue-700">{checkoutCount} sem checkout</span>
          {" · "}
          <span className="font-semibold text-amber-700">{rows.length - checkoutCount} sem check-in</span>
        </p>
      )}

      {baseCodes.map((code) => {
        const list = byBase.get(code)!;
        const style = getBaseStyleByCode(code);
        return (
          <section key={code} className={cn("overflow-hidden rounded-xl border bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]", style.border)}>
            <header className={cn("flex items-center gap-2 px-3 py-2", style.bg)}>
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", style.dot)} />
              <span className={cn("text-sm font-bold", style.text)}>{code}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{list[0].baseName}</span>
              <span className={cn("rounded-full px-2 text-[11px] font-semibold", style.badge)}>{list.length}</span>
            </header>

            {(["DAY", "NIGHT"] as const).map((period) => {
              const items = list
                .filter((r) => r.period === period)
                .sort((a, b) => a.internName.localeCompare(b.internName, "pt-BR"));
              if (items.length === 0) return null;
              return (
                <div key={period} className="border-t border-slate-100">
                  <p className={cn(
                    "flex items-center gap-1 px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide",
                    period === "DAY" ? "text-amber-700" : "text-indigo-700",
                  )}>
                    {period === "DAY" ? <Sun className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />}
                    {period === "DAY" ? "Diurno" : "Noturno"}
                  </p>
                  <ul className="divide-y divide-slate-100">
                    {items.map((r) => {
                      const faculty = getFacultyStyle(r.facultyAbbr);
                      const entrou = clockTime(r.checkinAt);
                      return (
                        <li key={r.id} className="px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="break-words text-[15px] font-semibold leading-snug text-slate-900">{r.internName}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", faculty.pill)}>{r.facultyAbbr || "Sem faculdade"}</span>
                                {shiftLabel(r.shift) && (
                                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600">{shiftLabel(r.shift)}</span>
                                )}
                                {r.kind === "CHECKOUT" ? (
                                  <span className="flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
                                    <LogOut className="h-3 w-3" strokeWidth={1.5} />
                                    Sem checkout{entrou ? ` · entrou ${entrou}` : ""}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                                    <LogIn className="h-3 w-3" strokeWidth={1.5} />
                                    {r.status === "ABSENT" ? "Sem check-in · falta" : "Sem check-in"}
                                  </span>
                                )}
                              </div>
                            </div>
                            {r.kind === "CHECKOUT" && (
                              <Button
                                size="sm"
                                variant={openCheckout === r.id ? "default" : "outline"}
                                className="shrink-0 gap-1"
                                onClick={() => setOpenCheckout((cur) => (cur === r.id ? null : r.id))}
                              >
                                <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                                Checkout
                              </Button>
                            )}
                          </div>

                          {r.kind === "CHECKOUT" && openCheckout === r.id && (
                            <CheckoutNpsForm
                              submitting={submitting === r.id}
                              onCancel={() => setOpenCheckout(null)}
                              onSubmit={(nps, notes) => checkout(r.id, nps, notes)}
                            />
                          )}

                          {r.kind === "CHECKIN" && (
                            <div className="mt-2">
                              <AttendanceQuickActions
                                assignmentId={r.id}
                                status={r.status}
                                assignment={{ date: r.date, period: r.period, baseCode: r.baseCode, internName: r.internName }}
                                actions={["present", "excuse", "absent"]}
                                onUpdated={refresh}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
