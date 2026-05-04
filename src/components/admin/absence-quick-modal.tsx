"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertCircle, CheckCircle2, ExternalLink } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";
import { InternHistorySection, useInternHistory, COMPLIANCE_BADGE } from "@/components/admin/intern-history-section";
import type { AbsenceAlertItem } from "@/components/admin/cockpit-alarms";

const PERIOD_LABEL: Record<"DAY" | "NIGHT", string> = { DAY: "Diurno", NIGHT: "Noturno" };

function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

type Props = {
  absence: AbsenceAlertItem;
  onClose: () => void;
};

export function AbsenceQuickModal({ absence, onClose }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"dismiss" | "cancel" | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fst = getFacultyStyle(absence.facultyAbbr);
  const history = useInternHistory(absence.internId);
  const { compliance } = history;

  async function handleDismiss() {
    setBusy("dismiss");
    setError(null);
    try {
      const res = await fetch(`/taximetro/api/admin/absence-alerts/${absence.assignmentId}/dismiss`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Falha ao dispensar alerta");
        setBusy(null);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Erro de rede");
      setBusy(null);
    }
  }

  async function handleCancel() {
    setBusy("cancel");
    setError(null);
    try {
      const res = await fetch(`/taximetro/api/assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: absence.assignmentId,
          status: "CANCELLED",
          notes: "Plantão cancelado via card de faltas pendentes",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error ?? "Falha ao cancelar plantão");
        setBusy(null);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Erro de rede");
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-[fadeInUp_120ms_ease-out]"
      onClick={onClose}
    >
      <div
        className="relative max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Falta pendente</p>
            <div className="mt-0.5 flex items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-slate-900">{absence.internName}</h3>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${fst.pill}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                {absence.facultyAbbr}
              </span>
              {compliance && (
                <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${COMPLIANCE_BADGE[compliance.status].pill}`}>
                  {COMPLIANCE_BADGE[compliance.status].label}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {formatLongDate(absence.date)} · {absence.baseCode} · {PERIOD_LABEL[absence.period]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-6 py-4 space-y-5">
          {absence.hasJustification ? (
            <div className="rounded-lg bg-amber-50/60 ring-1 ring-amber-200 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-amber-600" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Justificada</p>
              </div>
              <p className="mt-1.5 text-sm text-slate-800">{absence.justification}</p>
              {(absence.justifiedBy || absence.justifiedAt) && (
                <p className="mt-1.5 text-[11px] text-amber-700/80">
                  {absence.justifiedBy && <>por {absence.justifiedBy}</>}
                  {absence.justifiedBy && absence.justifiedAt && " · "}
                  {absence.justifiedAt && new Date(absence.justifiedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-red-50/60 ring-1 ring-red-200 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700">Sem justificativa</p>
              </div>
              <p className="mt-1.5 text-xs text-red-700/90">
                Investigue antes de decidir. Se for falta verdadeira, deixe no alerta até alguém justificar. Se for erro de escala, cancele o plantão.
              </p>
            </div>
          )}

          <InternHistorySection data={history} />

          <a
            href={`/taximetro/admin/ver-interno?internId=${absence.internId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-700"
          >
            Ver perfil completo do interno
            <ExternalLink className="h-3 w-3" />
          </a>

          {error && (
            <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700 ring-1 ring-red-200">
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-slate-100 bg-slate-50 px-6 py-3">
          {!confirmCancel ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleDismiss}
                disabled={busy !== null}
                className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200 disabled:opacity-50"
              >
                {busy === "dismiss" ? "Limpando…" : "Limpar do alerta"}
              </button>
              <button
                onClick={() => setConfirmCancel(true)}
                disabled={busy !== null}
                className="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100 disabled:opacity-50"
              >
                Cancelar plantão (remover da escala)
              </button>
              <span className="ml-auto text-[10px] text-slate-400">
                Limpar mantém em banco · Cancelar remove
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-700">
                Vai remover este plantão da escala. Falta deixa de existir como falta no relatório. Tem certeza?
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancel}
                  disabled={busy !== null}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy === "cancel" ? "Cancelando…" : "Sim, cancelar plantão"}
                </button>
                <button
                  onClick={() => setConfirmCancel(false)}
                  disabled={busy !== null}
                  className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
                >
                  Voltar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
