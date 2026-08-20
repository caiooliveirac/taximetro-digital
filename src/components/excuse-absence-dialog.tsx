"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { manualAttendanceAction } from "@/app/admin/actions";

export const EXCUSE_PRESETS = [
    "Liberado pela coordenação da faculdade devido a uma prova",
    "Liberado da reposição devido a atestado médico",
    "Plantão não realizado por problema do serviço, não do aluno",
    "Troca de plantão autorizada pela coordenação",
    "Participação em atividade acadêmica obrigatória",
];

type ExcuseAbsenceDialogProps = {
    assignment: {
        id: string;
        date?: string;
        period?: string;
        baseCode?: string;
        absenceJustification?: string | null;
    } | null;
    onClose: () => void;
    onDone: () => void | Promise<void>;
};

export function ExcuseAbsenceDialog({ assignment, onClose, onDone }: ExcuseAbsenceDialogProps) {
    const [text, setText] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [, startTransition] = useTransition();

    if (!assignment) return null;
    const currentAssignment = assignment;

    function submit(justification: string) {
        if (!justification.trim()) {
            setError("Escolha um motivo ou escreva a justificativa — ela vai para o relatório.");
            return;
        }
        setLoading(true);
        setError("");

        startTransition(async () => {
            try {
                const result = await manualAttendanceAction({
                    assignmentId: currentAssignment.id,
                    action: "EXCUSE_ABSENCE",
                    ...(justification.trim() ? { justification: justification.trim() } : {}),
                });
                if (!result.success) {
                    setError(result.error);
                    return;
                }
                await onDone();
                onClose();
            } catch {
                setError("Erro ao abonar a falta. Tente novamente.");
            } finally {
                setLoading(false);
            }
        });
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        submit(text);
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={onClose}
            onKeyDown={(e) => {
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
                            <ShieldCheck className="h-5 w-5 text-violet-600" strokeWidth={1.8} />
                            <h2 className="text-lg font-semibold text-slate-900">Abonar falta</h2>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                            {[
                                currentAssignment.baseCode,
                                currentAssignment.date ? new Date(`${currentAssignment.date}T12:00:00`).toLocaleDateString("pt-BR") : null,
                                currentAssignment.period ? (currentAssignment.period === "DAY" ? "Diurno" : "Noturno") : null,
                            ].filter(Boolean).join(" · ")}
                        </p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
                    <p className="text-sm text-slate-600">
                        O plantão ficará registrado como <span className="font-semibold text-violet-700">falta abonada</span> — entra
                        no relatório como carga horária cumprida, com o motivo por extenso, sem virar presença.
                    </p>

                    <div>
                        <span className="mb-1.5 block text-sm font-medium text-slate-700">Motivo do abono</span>
                        <div className="flex flex-wrap gap-1.5">
                            {EXCUSE_PRESETS.map((preset) => (
                                <button
                                    key={preset}
                                    type="button"
                                    disabled={loading}
                                    onClick={() => setText(preset)}
                                    className={`rounded-full border px-2.5 py-1 text-left text-xs font-medium transition ${text === preset
                                        ? "border-violet-300 bg-violet-100 text-violet-800"
                                        : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
                                >
                                    {preset}
                                </button>
                            ))}
                        </div>
                    </div>

                    <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-700">Justificativa por escrito</span>
                        <textarea
                            value={text}
                            onChange={(event) => setText(event.target.value)}
                            rows={3}
                            placeholder="Clique num motivo acima ou descreva o abono com suas palavras."
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:ring-1 focus:ring-accent-400"
                        />
                    </label>

                    {currentAssignment.absenceJustification && !text.trim() && (
                        <p className="text-xs text-slate-500">
                            Sem novo texto, a justificativa já registrada será mantida: “{currentAssignment.absenceJustification}”
                        </p>
                    )}

                    {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
                        <Button type="submit" disabled={loading || !text.trim()}>
                            {loading
                                ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Abonando...</span>
                                : "Abonar falta"}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
}
