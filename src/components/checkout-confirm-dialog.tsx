"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, LogOut, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { manualAttendanceAction } from "@/app/admin/actions";

type Preceptor = { id: string; name: string; baseCodes: string[] };

type CheckoutConfirmDialogProps = {
    assignment: {
        id: string;
        date?: string;
        period?: string;
        baseCode?: string;
        internName?: string;
    } | null;
    onClose: () => void;
    onDone: () => void | Promise<void>;
};

/**
 * Checkout manual de um plantão que já tem check-in. O horário gravado é o
 * plausível do turno (pickPlausibleShiftTimes), não o instante do clique — e
 * quem assina é o preceptor que estava na base, escolhido aqui.
 */
export function CheckoutConfirmDialog({ assignment, onClose, onDone }: CheckoutConfirmDialogProps) {
    const [preceptors, setPreceptors] = useState<Preceptor[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [search, setSearch] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [, startTransition] = useTransition();

    useEffect(() => {
        let active = true;
        fetch("/taximetro/api/admin/preceptors")
            .then((res) => res.json())
            .then((json) => {
                if (!active) return;
                if (json.success) setPreceptors(json.data as Preceptor[]);
                else setError(json.error ?? "Não foi possível carregar os preceptores.");
            })
            .catch(() => { if (active) setError("Não foi possível carregar os preceptores."); })
            .finally(() => { if (active) setLoadingList(false); });
        return () => { active = false; };
    }, []);

    const baseCode = assignment?.baseCode;
    // Os da base do plantão primeiro: é entre eles que está a resposta certa.
    const ordered = useMemo(() => {
        const term = search.trim().toLowerCase();
        const filtered = term ? preceptors.filter((p) => p.name.toLowerCase().includes(term)) : preceptors;
        if (!baseCode) return filtered;
        return [...filtered].sort((left, right) => {
            const leftIsBase = left.baseCodes.includes(baseCode) ? 0 : 1;
            const rightIsBase = right.baseCodes.includes(baseCode) ? 0 : 1;
            return leftIsBase - rightIsBase || left.name.localeCompare(right.name, "pt-BR");
        });
    }, [preceptors, search, baseCode]);

    if (!assignment) return null;
    const currentAssignment = assignment;

    const checkoutHint = currentAssignment.period === "NIGHT"
        ? "por volta das 07:00 do dia seguinte"
        : currentAssignment.period === "DAY"
            ? "por volta das 19:00 do mesmo dia"
            : null;

    function submit() {
        setSaving(true);
        setError("");

        startTransition(async () => {
            try {
                const result = await manualAttendanceAction({
                    assignmentId: currentAssignment.id,
                    action: "CONFIRM_CHECKOUT",
                    ...(selectedId ? { checkoutBy: selectedId } : {}),
                });
                if (!result.success) {
                    setError(result.error);
                    return;
                }
                await onDone();
                onClose();
            } catch {
                setError("Erro ao confirmar o checkout. Tente novamente.");
            } finally {
                setSaving(false);
            }
        });
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => { if (!saving) onClose(); }}>
            <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <LogOut className="h-5 w-5 text-sky-600" strokeWidth={1.8} />
                            <h2 className="text-lg font-semibold text-slate-900">Confirmar checkout</h2>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                            {[
                                currentAssignment.internName,
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

                <div className="space-y-4 px-6 py-5">
                    <p className="text-sm text-slate-600">
                        {checkoutHint
                            ? <>O checkout será gravado <span className="font-semibold text-sky-700">{checkoutHint}</span>, coerente com o turno — não com a hora em que você clicou.</>
                            : <>O checkout será gravado num horário coerente com o fim do turno — não com a hora em que você clicou.</>}
                    </p>

                    <div>
                        <span className="mb-1.5 block text-sm font-medium text-slate-700">Checkout em nome de</span>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar preceptor pelo nome"
                                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:ring-1 focus:ring-accent-400"
                            />
                        </div>

                        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-100 p-1">
                            {loadingList && (
                                <p className="px-3 py-4 text-center text-sm text-slate-400">Carregando preceptores...</p>
                            )}
                            {!loadingList && ordered.length === 0 && (
                                <p className="px-3 py-4 text-center text-sm text-slate-400">Nenhum preceptor encontrado.</p>
                            )}
                            {ordered.map((preceptor) => (
                                <button
                                    key={preceptor.id}
                                    type="button"
                                    disabled={saving}
                                    onClick={() => setSelectedId(preceptor.id === selectedId ? "" : preceptor.id)}
                                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${preceptor.id === selectedId
                                        ? "bg-sky-100 font-semibold text-sky-900"
                                        : "text-slate-700 hover:bg-slate-50"}`}
                                >
                                    <span className="truncate">{preceptor.name}</span>
                                    <span className="flex shrink-0 gap-1">
                                        {preceptor.baseCodes.map((code) => (
                                            <span
                                                key={code}
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${code === baseCode
                                                    ? "bg-sky-600 text-white"
                                                    : "bg-slate-100 text-slate-500"}`}
                                            >
                                                {code}
                                            </span>
                                        ))}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <p className="mt-1.5 text-xs text-slate-500">
                            Sem escolher ninguém, o checkout fica registrado no seu nome.
                        </p>
                    </div>

                    {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
                        <Button type="button" onClick={submit} disabled={saving}>
                            {saving
                                ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Confirmando...</span>
                                : "Confirmar checkout"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
