"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, ShieldCheck, UserX } from "lucide-react";
import { manualAttendanceAction } from "@/app/admin/actions";
import { ExcuseAbsenceDialog } from "@/components/excuse-absence-dialog";

/**
 * Presença / abono / falta em um clique, na própria tela da escala e na tela do
 * preceptor. Antes era preciso abrir o modal do plantão, lançar a falta e só
 * então abonar — três passos para uma decisão que se toma na base, na hora.
 */

type QuickAction = "CONFIRM_PRESENT" | "MARK_ABSENT" | "EXCUSE_ABSENCE";

const PRESENT_FROM = new Set(["SCHEDULED", "CONFIRMED", "ABSENT", "EXCUSED"]);
const ABSENT_FROM = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "EXCUSED"]);
const EXCUSE_FROM = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN", "ABSENT"]);

export function attendanceQuickActionsAvailable(status: string) {
    return PRESENT_FROM.has(status) || ABSENT_FROM.has(status) || EXCUSE_FROM.has(status);
}

export function AttendanceQuickActions({
    assignmentId,
    status,
    assignment,
    variant = "labeled",
    actions = ["present", "excuse", "absent"],
    onUpdated,
}: {
    assignmentId: string;
    status: string;
    assignment?: { date?: string; period?: string; baseCode?: string; absenceJustification?: string | null };
    variant?: "labeled" | "icon";
    /** Omitir "present" onde a tela já tem o botão próprio de check-in. */
    actions?: Array<"present" | "excuse" | "absent">;
    onUpdated?: () => void | Promise<void>;
}) {
    const [pending, setPending] = useState<QuickAction | null>(null);
    const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);
    const [excuseOpen, setExcuseOpen] = useState(false);
    const [, startTransition] = useTransition();

    const canPresent = actions.includes("present") && PRESENT_FROM.has(status);
    const canAbsent = actions.includes("absent") && ABSENT_FROM.has(status);
    const canExcuse = actions.includes("excuse") && EXCUSE_FROM.has(status);

    if (!canPresent && !canAbsent && !canExcuse) return null;

    function runAction(action: Exclude<QuickAction, "EXCUSE_ABSENCE">) {
        // Falta dispara aviso no Telegram para os líderes da faculdade. Num botão
        // de 28px na grade, o clique errado é barato demais sem esta pergunta.
        if (action === "MARK_ABSENT" && !window.confirm("Lançar falta neste plantão? Os líderes da faculdade são avisados.")) return;
        setPending(action);
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
                        ? "Presença registrada — carga horária cumprida."
                        : notifications > 0
                            ? `Falta lançada. ${notifications} líder(es) avisado(s).`
                            : "Falta lançada.",
                });
                await onUpdated?.();
            } catch (error) {
                setFeedback({ type: "error", text: error instanceof Error ? error.message : "Erro ao registrar a ação" });
            } finally {
                setPending(null);
            }
        });
    }

    const isIcon = variant === "icon";
    const shape = isIcon
        ? "inline-flex h-7 w-7 touch-manipulation items-center justify-center rounded-md border shadow-sm transition disabled:cursor-wait disabled:opacity-60"
        : "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60";
    const iconSize = isIcon ? "h-3.5 w-3.5" : "h-3.5 w-3.5";

    return (
        <>
            <div className={isIcon ? "flex items-center gap-1" : "flex flex-wrap items-center gap-1.5"}>
                {canPresent && (
                    <button
                        type="button"
                        title="Presença — conta como carga horária cumprida"
                        aria-label="Registrar presença"
                        onClick={(event) => { event.stopPropagation(); runAction("CONFIRM_PRESENT"); }}
                        disabled={pending !== null}
                        className={`${shape} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
                    >
                        {pending === "CONFIRM_PRESENT"
                            ? <Loader2 className={`${iconSize} animate-spin`} />
                            : <CheckCircle2 className={iconSize} strokeWidth={2.2} />}
                        {!isIcon && "Presença"}
                    </button>
                )}
                {canExcuse && (
                    <button
                        type="button"
                        title="Abonar falta — carga horária cumprida com justificativa"
                        aria-label="Abonar falta"
                        onClick={(event) => { event.stopPropagation(); setExcuseOpen(true); }}
                        disabled={pending !== null}
                        className={`${shape} border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100`}
                    >
                        <ShieldCheck className={iconSize} strokeWidth={2.2} />
                        {!isIcon && "Abonar"}
                    </button>
                )}
                {canAbsent && (
                    <button
                        type="button"
                        title="Lançar falta"
                        aria-label="Lançar falta"
                        onClick={(event) => { event.stopPropagation(); runAction("MARK_ABSENT"); }}
                        disabled={pending !== null}
                        className={`${shape} border-red-300 bg-red-50 text-red-700 hover:bg-red-100`}
                    >
                        {pending === "MARK_ABSENT"
                            ? <Loader2 className={`${iconSize} animate-spin`} />
                            : <UserX className={iconSize} strokeWidth={2.2} />}
                        {!isIcon && "Falta"}
                    </button>
                )}
            </div>

            {feedback && !isIcon && (
                <p className={`mt-1 text-[11px] ${feedback.type === "error" ? "text-red-600" : "text-emerald-600"}`}>
                    {feedback.text}
                </p>
            )}
            {feedback && isIcon && (
                <p className={`absolute bottom-full right-0 mb-1 w-max max-w-[220px] rounded px-1.5 py-0.5 text-[10px] text-white shadow ${feedback.type === "error" ? "bg-red-600" : "bg-emerald-600"}`}>
                    {feedback.text}
                </p>
            )}

            {excuseOpen && (
                <ExcuseAbsenceDialog
                    assignment={{ id: assignmentId, ...assignment }}
                    onClose={() => setExcuseOpen(false)}
                    onDone={async () => {
                        setFeedback({ type: "success", text: "Falta abonada — carga horária cumprida." });
                        await onUpdated?.();
                    }}
                />
            )}
        </>
    );
}
