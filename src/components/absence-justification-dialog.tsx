"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { FileText, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveAbsenceJustificationAction } from "@/app/admin/actions";

type AbsenceJustificationAssignment = {
    id: string;
    date: string;
    period: string;
    baseCode: string;
    baseName?: string;
    absenceJustification?: string | null;
    absenceJustificationActor?: string | null;
    absenceJustificationAt?: string | null;
};

type AbsenceJustificationDialogProps = {
    assignment: AbsenceJustificationAssignment | null;
    title: string;
    onClose: () => void;
    onSaved: (assignmentId: string, data: {
        absenceJustification: string | null;
        absenceJustificationActor: string | null;
        absenceJustificationAt: string | null;
    }) => void;
};

function formatPeriod(period: string) {
    return period === "DAY" ? "Diurno" : "Noturno";
}

function formatJustificationActor(actor: string | null | undefined) {
    if (actor === "INTERN") return "pelo aluno";
    if (actor === "LEADER") return "pelo líder";
    if (actor === "COORDINATOR") return "pela coordenação";
    return "";
}

export function AbsenceJustificationDialog({ assignment, title, onClose, onSaved }: AbsenceJustificationDialogProps) {
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(false);
    const [, startTransition] = useTransition();
    const [error, setError] = useState("");

    useEffect(() => {
        setText(assignment?.absenceJustification ?? "");
        setError("");
        setLoading(false);
    }, [assignment]);

    if (!assignment) return null;

    const currentAssignment = assignment;

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (text.trim().length < 5) {
            setError("Descreva a justificativa com pelo menos 5 caracteres.");
            return;
        }

        setLoading(true);
        setError("");

        startTransition(async () => {
            try {
                const result = await saveAbsenceJustificationAction(currentAssignment.id, { justification: text });
                if (!result.success) {
                    setError(result.error);
                    return;
                }
                onSaved(currentAssignment.id, result.data);
                onClose();
            } catch {
                setError("Erro de conexão. Tente novamente.");
            } finally {
                setLoading(false);
            }
        });
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={onClose}
            onKeyDown={(e) => {
                // Esc fecha só o diálogo — não o drawer que pode estar por baixo.
                if (e.key === "Escape") {
                    e.stopPropagation();
                    onClose();
                }
            }}
        >
            <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-accent-600" strokeWidth={1.8} />
                            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                            {currentAssignment.baseCode} · {new Date(`${currentAssignment.date}T12:00:00`).toLocaleDateString("pt-BR")} · {formatPeriod(currentAssignment.period)}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
                    {currentAssignment.absenceJustification && (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                            <p className="font-medium text-slate-900">Justificativa atual</p>
                            <p className="mt-1 whitespace-pre-wrap">{currentAssignment.absenceJustification}</p>
                            {currentAssignment.absenceJustificationAt && (
                                <p className="mt-2 text-xs text-slate-500">
                                    Atualizada {formatJustificationActor(currentAssignment.absenceJustificationActor)} em {new Date(currentAssignment.absenceJustificationAt).toLocaleString("pt-BR")}
                                </p>
                            )}
                        </div>
                    )}

                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-700">Texto da justificativa</span>
                        <textarea
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            rows={6}
                            placeholder="Descreva o motivo da falta e, se necessário, o que já foi alinhado para compensação."
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:ring-1 focus:ring-accent-400"
                        />
                    </label>

                    {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</span> : "Salvar justificativa"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}