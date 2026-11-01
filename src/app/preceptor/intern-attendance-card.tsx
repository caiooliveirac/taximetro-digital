"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, LogOut, MessageCircle, UserX } from "lucide-react";
import { manualAttendanceAction } from "@/app/admin/actions";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { StatusBadge } from "@/components/status-badge";
import { getFacultyStyle } from "@/lib/base-colors";
import { cn, isWithinShiftCheckoutWindow, localDateStr } from "@/lib/utils";
import { whatsappLink } from "@/lib/whatsapp";
import { CheckoutNpsForm, type CheckoutNps } from "./checkout-nps-form";

export type CardAssignment = {
  id: string;
  internId: string;
  internName: string;
  internPhone?: string | null;
  facultyAbbr: string;
  baseCode: string;
  date: string;
  period: string;
  shift: string | null;
  status: string;
};

const CHECKIN_FROM = new Set(["SCHEDULED", "CONFIRMED", "ABSENT", "EXCUSED"]);
const DIRECT_CHECKIN_FROM = new Set(["SCHEDULED", "CONFIRMED"]);
const ABSENT_FROM = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "EXCUSED"]);

function shiftLabel(shift: string | null) {
  if (shift === "MORNING") return "Manhã";
  if (shift === "AFTERNOON") return "Tarde";
  return null;
}

function checkoutOpensAt(period: string, shift: string | null) {
  if (period !== "DAY") return "23:00";
  return shift === "AFTERNOON" ? "17:00" : "11:00";
}

/**
 * Um interno na tela do preceptor: foto, WhatsApp e as ações em botões
 * grandes — check-in, falta e, quando já entrou, checkout. Abono não existe
 * aqui: é decisão da coordenação. Checkout antes da hora fica travado (o
 * servidor também recusa).
 */
export function InternAttendanceCard({
  assignment: a,
  canCheckout,
  checkinMode,
  badge,
  onUpdated,
}: {
  assignment: CardAssignment;
  canCheckout: boolean;
  checkinMode: "validate" | "manual";
  badge?: React.ReactNode;
  onUpdated: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState<"CHECKIN" | "ABSENT" | "CHECKOUT" | null>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [npsOpen, setNpsOpen] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [, startTransition] = useTransition();

  const photoSrc = `/taximetro/api/admin/users/${a.internId}/selfie`;
  const whatsapp = whatsappLink(a.internPhone);
  const faculty = getFacultyStyle(a.facultyAbbr);
  const canCheckin = !canCheckout && CHECKIN_FROM.has(a.status);
  const canAbsent = ABSENT_FROM.has(a.status);
  const checkoutTooEarly = canCheckout
    && a.date >= localDateStr()
    && !isWithinShiftCheckoutWindow(a.date, a.period as "DAY" | "NIGHT", a.shift);

  function run(kind: "CHECKIN" | "ABSENT", task: () => Promise<{ ok: boolean; text: string }>) {
    setPending(kind);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await task();
        setFeedback({ type: result.ok ? "success" : "error", text: result.text });
        if (result.ok) await onUpdated();
      } catch {
        setFeedback({ type: "error", text: "Erro de conexão. Tente novamente." });
      } finally {
        setPending(null);
      }
    });
  }

  function checkin() {
    run("CHECKIN", async () => {
      // Plantão de agora passa pela validação normal (com as janelas dela);
      // falta/abono revertidos e datas passadas entram como presença manual.
      if (checkinMode === "validate" && DIRECT_CHECKIN_FROM.has(a.status)) {
        const res = await fetch("/taximetro/api/attendance/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
          body: JSON.stringify({ assignmentId: a.id }),
        });
        const json = await res.json();
        return json.success ? { ok: true, text: "Check-in registrado." } : { ok: false, text: json.error ?? "Não foi possível registrar." };
      }
      const result = await manualAttendanceAction({ assignmentId: a.id, action: "CONFIRM_PRESENT" });
      return result.success ? { ok: true, text: "Check-in registrado." } : { ok: false, text: result.error };
    });
  }

  function absent() {
    if (!window.confirm(`Lançar falta para ${a.internName}? Os líderes da faculdade são avisados.`)) return;
    run("ABSENT", async () => {
      const result = await manualAttendanceAction({ assignmentId: a.id, action: "MARK_ABSENT" });
      if (!result.success) return { ok: false, text: result.error };
      const notified = Number(result.data?.leaderNotificationsSent ?? 0);
      return { ok: true, text: notified > 0 ? `Falta lançada. ${notified} líder(es) avisado(s).` : "Falta lançada." };
    });
  }

  async function checkout(nps: CheckoutNps, notes: string) {
    setPending("CHECKOUT");
    setFeedback(null);
    try {
      const res = await fetch("/taximetro/api/attendance/checkout", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-force-role": "PRECEPTOR" },
        body: JSON.stringify({ assignmentId: a.id, nps, notes }),
      });
      const json = await res.json();
      if (json.success) {
        const total = Array.isArray(json.data?.assignmentIds) ? json.data.assignmentIds.length : 1;
        setFeedback({ type: "success", text: total > 1 ? `Checkout confirmado (${total} turnos).` : "Checkout confirmado." });
        setNpsOpen(false);
        await onUpdated();
      } else {
        setFeedback({ type: "error", text: json.error || "Não foi possível confirmar checkout." });
      }
    } catch {
      setFeedback({ type: "error", text: "Erro de conexão. Tente novamente." });
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        {photoFailed ? (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xl font-semibold text-slate-400">
            {a.internName.charAt(0)}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoSrc}
            alt={`Foto de ${a.internName}`}
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            onClick={() => setLightbox(true)}
            className="h-14 w-14 shrink-0 cursor-zoom-in rounded-xl object-cover ring-1 ring-slate-200"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="break-words text-[15px] font-semibold leading-snug text-slate-900">{a.internName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", faculty.pill)}>{a.facultyAbbr || "Sem faculdade"}</span>
            {shiftLabel(a.shift) && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-600">{shiftLabel(a.shift)}</span>}
            {a.status !== "SCHEDULED" && a.status !== "CONFIRMED" && <StatusBadge status={a.status} />}
            {badge}
          </div>
        </div>
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`WhatsApp de ${a.internName}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-sm active:scale-95"
          >
            <MessageCircle className="h-5 w-5" strokeWidth={2.2} />
          </a>
        )}
      </div>

      {(canCheckin || canAbsent || canCheckout) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {canCheckin && (
            <button
              type="button"
              onClick={checkin}
              disabled={busy}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white transition hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60"
            >
              {pending === "CHECKIN" ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
              Check-in
            </button>
          )}
          {canCheckout && (
            <button
              type="button"
              onClick={() => setNpsOpen((open) => !open)}
              disabled={busy || checkoutTooEarly}
              className="flex min-h-[52px] flex-col items-center justify-center rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white transition hover:bg-blue-700 active:scale-[0.98] disabled:bg-blue-100 disabled:text-blue-700"
            >
              <span className="flex items-center gap-2">
                {pending === "CHECKOUT" ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogOut className="h-5 w-5" />}
                Checkout
              </span>
              {checkoutTooEarly && <span className="text-[10px] font-medium">libera às {checkoutOpensAt(a.period, a.shift)}</span>}
            </button>
          )}
          {canAbsent && (
            <button
              type="button"
              onClick={absent}
              disabled={busy}
              className={cn(
                "flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 active:scale-[0.98] disabled:opacity-60",
                !canCheckin && !canCheckout && "col-span-2",
              )}
            >
              {pending === "ABSENT" ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserX className="h-5 w-5" />}
              Falta
            </button>
          )}
        </div>
      )}

      {npsOpen && canCheckout && !checkoutTooEarly && (
        <CheckoutNpsForm
          submitting={pending === "CHECKOUT"}
          onCancel={() => setNpsOpen(false)}
          onSubmit={(nps, notes) => checkout(nps, notes)}
        />
      )}

      {feedback && (
        <p className={cn("mt-2 text-xs", feedback.type === "error" ? "text-red-600" : "text-emerald-600")}>{feedback.text}</p>
      )}

      {lightbox && !photoFailed && (
        <PhotoLightbox src={photoSrc} alt={`Foto de ${a.internName}`} onClose={() => setLightbox(false)} />
      )}
    </li>
  );
}
