"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, LogIn, ShieldCheck, UserX } from "lucide-react";
import { manualAttendanceAction } from "@/app/admin/actions";
import { ExcuseAbsenceDialog } from "@/components/excuse-absence-dialog";
import { CheckoutConfirmDialog } from "@/components/checkout-confirm-dialog";

type Option = "FULL" | "CHECKIN" | "ABSENT" | "EXCUSED";

// Mesmas regras do AdminManualAttendanceActions / handle-manual-attendance.
const CHECKIN_FROM = new Set(["SCHEDULED", "CONFIRMED", "ABSENT", "EXCUSED"]);
const ABSENT_FROM = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN"]);
const EXCUSE_FROM = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "ABSENT"]);

const CURRENT: Record<string, Option> = {
    CHECKED_OUT: "FULL",
    CHECKED_IN: "CHECKIN",
    ABSENT: "ABSENT",
    EXCUSED: "EXCUSED",
};

const STYLE: Record<Option, { idle: string; active: string }> = {
    FULL: { idle: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100", active: "border-emerald-600 bg-emerald-600 text-white" },
    CHECKIN: { idle: "border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100", active: "border-sky-600 bg-sky-600 text-white" },
    ABSENT: { idle: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100", active: "border-red-600 bg-red-600 text-white" },
    EXCUSED: { idle: "border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100", active: "border-violet-600 bg-violet-600 text-white" },
};

/**
 * As quatro saídas de um plantão em botões grandes: presença completa
 * (check-in + checkout), só check-in, falta e falta abonada. O estado atual
 * aparece preenchido.
 */
export function AttendanceQuickButtons({
    assignmentId,
    status,
    assignment,
    onUpdated,
}: {
    assignmentId: string;
    status: string;
    assignment: { date?: string; period?: string; baseCode?: string; internName?: string };
    onUpdated?: () => void | Promise<void>;
}) {
    const [pending, setPending] = useState<Option | null>(null);
    const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [excuseOpen, setExcuseOpen] = useState(false);
    const [, startTransition] = useTransition();

    const current = CURRENT[status] ?? null;
    const enabled: Record<Option, boolean> = {
        FULL: CHECKIN_FROM.has(status) || status === "CHECKED_IN",
        CHECKIN: CHECKIN_FROM.has(status),
        ABSENT: ABSENT_FROM.has(status),
        EXCUSED: EXCUSE_FROM.has(status),
    };

    function run(option: Option, action: "CONFIRM_PRESENT" | "MARK_ABSENT", then?: () => void) {
        setPending(option);
        setFeedback(null);
        startTransition(async () => {
            try {
                const result = await manualAttendanceAction({ assignmentId, action });
                if (!result.success) {
                    setFeedback({ type: "error", text: result.error });
                    return;
                }
                const notifications = Number(result.data?.leaderNotificationsSent ?? 0);
                setFeedback({
                    type: "success",
                    text: action === "CONFIRM_PRESENT"
                        ? (then ? "Check-in registrado. Falta o checkout." : "Check-in registrado.")
                        : notifications > 0 ? `Falta lançada. ${notifications} líder(es) avisado(s).` : "Falta lançada.",
                });
                await onUpdated?.();
                then?.();
            } catch (error) {
                setFeedback({ type: "error", text: error instanceof Error ? error.message : "Erro ao registrar a ação" });
            } finally {
                setPending(null);
            }
        });
    }

    function choose(option: Option) {
        if (option === "FULL") {
            if (status === "CHECKED_IN") setCheckoutOpen(true);
            else run("FULL", "CONFIRM_PRESENT", () => setCheckoutOpen(true));
        } else if (option === "CHECKIN") {
            run("CHECKIN", "CONFIRM_PRESENT");
        } else if (option === "ABSENT") {
            if (window.confirm("Lançar falta neste plantão? Os líderes da faculdade são avisados.")) run("ABSENT", "MARK_ABSENT");
        } else {
            setExcuseOpen(true);
        }
    }

    const options: Array<{ key: Option; label: string; hint: string; icon: typeof CheckCircle2 }> = [
        { key: "FULL", label: "Presença completa", hint: "check-in + checkout", icon: CheckCircle2 },
        { key: "CHECKIN", label: "Só check-in", hint: "checkout fica aberto", icon: LogIn },
        { key: "ABSENT", label: "Falta", hint: "avisa os líderes", icon: UserX },
        { key: "EXCUSED", label: "Falta abonada", hint: "conta como cumprido", icon: ShieldCheck },
    ];

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
                {options.map(({ key, label, hint, icon: Icon }) => {
                    const isCurrent = current === key;
                    const disabled = pending !== null || isCurrent || !enabled[key];
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => choose(key)}
                            disabled={disabled}
                            aria-pressed={isCurrent}
                            className={`flex min-h-[64px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${isCurrent ? STYLE[key].active : STYLE[key].idle} ${!isCurrent && !enabled[key] ? "opacity-40" : ""} disabled:cursor-not-allowed`}
                        >
                            {pending === key ? <Loader2 className="h-6 w-6 shrink-0 animate-spin" /> : <Icon className="h-6 w-6 shrink-0" strokeWidth={2} />}
                            <span className="min-w-0">
                                <span className="block text-sm font-semibold leading-tight">{label}</span>
                                <span className={`block text-[11px] leading-tight ${isCurrent ? "text-white/80" : "opacity-70"}`}>{isCurrent ? "situação atual" : hint}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
            {feedback && (
                <p className={`text-xs ${feedback.type === "error" ? "text-red-600" : "text-emerald-600"}`}>{feedback.text}</p>
            )}
            {checkoutOpen && (
                <CheckoutConfirmDialog
                    assignment={{ id: assignmentId, ...assignment }}
                    onClose={() => setCheckoutOpen(false)}
                    onDone={async () => {
                        setFeedback({ type: "success", text: "Presença completa registrada." });
                        await onUpdated?.();
                    }}
                />
            )}
            {excuseOpen && (
                <ExcuseAbsenceDialog
                    assignment={{ id: assignmentId, ...assignment }}
                    onClose={() => setExcuseOpen(false)}
                    onDone={async () => {
                        setFeedback({ type: "success", text: "Falta abonada." });
                        await onUpdated?.();
                    }}
                />
            )}
        </div>
    );
}
