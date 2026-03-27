"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, LogOut, UserX } from "lucide-react";

type ManualAction = "CONFIRM_PRESENT" | "CONFIRM_CHECKOUT" | "MARK_ABSENT";

const CONFIRMABLE_STATUSES = new Set(["SCHEDULED", "CONFIRMED", "ABSENT"]);
const CHECKOUTABLE_STATUSES = new Set(["CHECKED_IN"]);
const ABSENCEABLE_STATUSES = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN"]);

export function AdminManualAttendanceActions({
    assignmentId,
    status,
    compact = false,
    onUpdated,
}: {
    assignmentId: string;
    status: string;
    compact?: boolean;
    onUpdated?: () => void | Promise<void>;
}) {
    const [pendingAction, setPendingAction] = useState<ManualAction | null>(null);
    const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

    const canConfirm = CONFIRMABLE_STATUSES.has(status);
    const canCheckout = CHECKOUTABLE_STATUSES.has(status);
    const canMarkAbsent = ABSENCEABLE_STATUSES.has(status);

    if (!canConfirm && !canCheckout && !canMarkAbsent) return null;

    async function runAction(action: ManualAction) {
        setPendingAction(action);
        setFeedback(null);

        try {
            const response = await fetch("/taximetro/api/admin/attendance/manual", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ assignmentId, action }),
            });

            const json = await response.json();
            if (!json.success) {
                setFeedback({ type: "error", text: json.error ?? "Não foi possível registrar a ação" });
                return;
            }

            const notifications = Number(json.data?.leaderNotificationsSent ?? 0);
            setFeedback({
                type: "success",
                text:
                    action === "CONFIRM_PRESENT"
                        ? "Presença confirmada manualmente."
                        : action === "CONFIRM_CHECKOUT"
                            ? "Checkout confirmado manualmente."
                            : notifications > 0
                                ? `Falta lançada. ${notifications} líder(es) avisado(s).`
                                : "Falta lançada manualmente.",
            });

            await onUpdated?.();
        } catch {
            setFeedback({ type: "error", text: "Erro de conexão ao registrar a ação" });
        } finally {
            setPendingAction(null);
        }
    }

    const buttonClass = compact
        ? "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition"
        : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition";

    return (
        <div className="flex flex-col items-end gap-1.5">
            <div className="flex flex-wrap justify-end gap-1.5">
                {canConfirm && (
                    <button
                        type="button"
                        onClick={() => runAction("CONFIRM_PRESENT")}
                        disabled={pendingAction !== null}
                        className={`${buttonClass} bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60`}
                    >
                        {pendingAction === "CONFIRM_PRESENT" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Confirmar presença
                    </button>
                )}
                {canCheckout && (
                    <button
                        type="button"
                        onClick={() => runAction("CONFIRM_CHECKOUT")}
                        disabled={pendingAction !== null}
                        className={`${buttonClass} bg-sky-50 text-sky-700 hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60`}
                    >
                        {pendingAction === "CONFIRM_CHECKOUT" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                        Confirmar checkout
                    </button>
                )}
                {canMarkAbsent && (
                    <button
                        type="button"
                        onClick={() => runAction("MARK_ABSENT")}
                        disabled={pendingAction !== null}
                        className={`${buttonClass} bg-red-50 text-red-700 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60`}
                    >
                        {pendingAction === "MARK_ABSENT" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                        Lançar falta
                    </button>
                )}
            </div>
            {feedback && (
                <p className={`text-[11px] ${feedback.type === "error" ? "text-red-600" : "text-emerald-600"}`}>
                    {feedback.text}
                </p>
            )}
        </div>
    );
}