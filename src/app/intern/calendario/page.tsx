"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { InternCalendar, type CalendarAssignment } from "@/components/intern-calendar";
import { InternDaySheet } from "@/components/intern-day-sheet";
import { temFeature } from "@/lib/instance";
import {
  colisoesComOutroServico,
  type SinalDoDia,
  type SinalMarcado,
} from "@/shared/domain/policies/day-signal-policy";

type ApiAssignment = CalendarAssignment & { internId?: string };

const DONE_STATUSES = new Set(["CHECKED_OUT", "VALIDATED", "APPROVED"]);
const COM_SINAIS = temFeature("sinaisDeTroca");

export default function InternCalendarPage() {
  const [assignments, setAssignments] = useState<CalendarAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sheetDate, setSheetDate] = useState<string | null>(null);
  const [sheetItems, setSheetItems] = useState<CalendarAssignment[]>([]);
  const [sinais, setSinais] = useState<SinalMarcado[]>([]);

  useEffect(() => {
    fetch("/taximetro/api/assignments?selfOnly=true")
      .then((r) => r.json())
      .then((json) => {
        if (json?.success) {
          const active = (json.data as ApiAssignment[]).filter((a) => a.status !== "CANCELLED");
          setAssignments(active);
        } else {
          setError("Não foi possível carregar seus plantões.");
        }
      })
      .catch(() => setError("Não foi possível carregar seus plantões."))
      .finally(() => setLoading(false));
    if (COM_SINAIS) {
      fetch("/taximetro/api/intern/sinais")
        .then((r) => r.json())
        .then((json) => { if (json?.success) setSinais(json.data); })
        .catch(() => {});
    }
  }, []);

  // Grava na hora na tela e volta atrás se o servidor recusar.
  const marcar = async (date: string, period: "DAY" | "NIGHT", signal: SinalDoDia | null, label?: string) => {
    const doTurno = (s: SinalMarcado) => s.date === date && s.period === period;
    const trocar = (novo: SinalMarcado | null) =>
      setSinais((atuais) => [...atuais.filter((s) => !doTurno(s)), ...(novo ? [novo] : [])]);
    const anterior = sinais.find(doTurno) ?? null;
    trocar(signal ? { date, period, signal, label: label || null } : null);
    try {
      const r = await fetch("/taximetro/api/intern/sinais", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, period, signal, label }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok || !json?.success) {
        trocar(anterior);
        return json?.error ?? "Não foi possível salvar. Tente de novo.";
      }
      return null;
    } catch {
      trocar(anterior);
      return "Sem conexão. Tente de novo.";
    }
  };

  const colisoes = useMemo(() => {
    const texto: Record<string, string> = {};
    for (const [id, s] of colisoesComOutroServico(assignments, sinais)) {
      const d = new Date(`${s.date}T12:00:00`);
      const quando = `${format(d, "EEE d/MM", { locale: ptBR })} ${s.period === "DAY" ? "diurno" : "noturno"}`;
      texto[id] = `Seu outro serviço${s.label ? ` em ${s.label}` : ""} (${quando}) fica colado neste plantão: seriam 24h seguidas. Para cumprir os dois, oferte este plantão para troca.`;
    }
    return texto;
  }, [assignments, sinais]);

  const rotationBounds = useMemo(() => {
    if (assignments.length === 0) return null;
    const dates = [...assignments].map((a) => a.date).sort();
    return { first: dates[0], last: dates[dates.length - 1] };
  }, [assignments]);

  const progress = useMemo(() => {
    const done = assignments.filter((a) => DONE_STATUSES.has(a.status)).length;
    const absent = assignments.filter((a) => a.status === "ABSENT").length;
    return { total: assignments.length, done, absent };
  }, [assignments]);

  const handleDayPick = (dateStr: string, items: CalendarAssignment[]) => {
    setSheetDate(dateStr);
    setSheetItems(items);
  };
  const closeSheet = () => {
    setSheetDate(null);
    setSheetItems([]);
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <CalendarDays className="h-6 w-6 text-accent-500" strokeWidth={1.5} />
          Calendário
        </h1>
        {rotationBounds && (
          <p className="mt-1 text-sm text-slate-500">
            Rodízio {formatRange(rotationBounds.first, rotationBounds.last)}
          </p>
        )}
        {progress.total > 0 && (
          <p className="mt-1 text-sm text-slate-500">
            <b className="font-semibold tabular-nums text-slate-900">{progress.total}</b> plantão{progress.total > 1 ? "ões" : ""}
            {" · "}
            <b className="font-semibold tabular-nums text-emerald-600">{progress.done}</b> concluído{progress.done === 1 ? "" : "s"}
            {progress.absent > 0 && (
              <>
                {" · "}
                <b className="font-semibold tabular-nums text-red-600">{progress.absent}</b> ausente{progress.absent > 1 ? "s" : ""}
              </>
            )}
          </p>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          Carregando...
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          Nenhum plantão escalado.
        </div>
      ) : (
        <InternCalendar
          assignments={assignments}
          onDayPick={handleDayPick}
          sinais={sinais}
          onMarcar={COM_SINAIS ? marcar : undefined}
        />
      )}

      <InternDaySheet
        open={!!sheetDate}
        dateStr={sheetDate}
        assignments={sheetItems}
        onClose={closeSheet}
        colisoes={colisoes}
      />
    </div>
  );
}

function formatRange(first: string, last: string): string {
  const f = new Date(`${first}T12:00:00`);
  const l = new Date(`${last}T12:00:00`);
  const sameYear = f.getFullYear() === l.getFullYear();
  const fFmt = sameYear ? "d MMM" : "d MMM yyyy";
  return `${format(f, fFmt, { locale: ptBR })} – ${format(l, "d MMM yyyy", { locale: ptBR })}`;
}
