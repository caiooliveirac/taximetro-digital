"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ArrowRightLeft, ChevronLeft, ChevronRight, Loader2, MapPin, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { addDaysToDateStr, operationalDateStr, startOfWeekDateStr } from "@/lib/utils";

type Base = {
    id: string;
    code: string;
    name: string;
    type: string;
    isActive: boolean;
};

type Assignment = {
    id: string;
    internId: string;
    internName: string;
    facultyId: string;
    facultyAbbr: string;
    baseId: string;
    baseCode: string;
    baseName: string;
    baseType: string;
    date: string;
    period: string;
    status: string;
    checkinStatus?: string | null;
};

type Scope = "admin" | "leader";

const ACTIONABLE_STATUSES = ["SCHEDULED", "CONFIRMED", "CHECKED_IN"];

function startOfWeek() {
    return startOfWeekDateStr(operationalDateStr());
}

function plusDays(date: string, days: number) {
    return addDaysToDateStr(date, days);
}

function formatDate(date: string) {
    return new Date(date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function periodLabel(period: string) {
    return period === "NIGHT" ? "Noturno" : "Diurno";
}

export function RemanejamentoPanel({ scope, highlightedAssignmentId }: { scope: Scope; highlightedAssignmentId?: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const [weekStart, setWeekStart] = useState(() => startOfWeek());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [bases, setBases] = useState<Base[]>([]);
    const [search, setSearch] = useState("");
    const [baseFilter, setBaseFilter] = useState("");
    const [statusFilter, setStatusFilter] = useState("");
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [modalAssignment, setModalAssignment] = useState<Assignment | null>(null);
    const [targetBaseId, setTargetBaseId] = useState("");
    const [reason, setReason] = useState("");
    const [authorized, setAuthorized] = useState(false);
    const [lastHighlightedId, setLastHighlightedId] = useState<string | undefined>(undefined);
    const [closedHighlighted, setClosedHighlighted] = useState(false);

    if (highlightedAssignmentId !== lastHighlightedId) {
        setLastHighlightedId(highlightedAssignmentId);
        setClosedHighlighted(false);
    }

    const weekEnd = useMemo(() => plusDays(weekStart, 6), [weekStart]);

    const load = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const [basesRes, assignmentsRes] = await Promise.all([
                fetch("/taximetro/api/admin/bases"),
                fetch(`/taximetro/api/assignments?from=${weekStart}&to=${weekEnd}`),
            ]);
            const [basesJson, assignmentsJson] = await Promise.all([basesRes.json(), assignmentsRes.json()]);

            if (!basesJson.success || !assignmentsJson.success) {
                throw new Error(assignmentsJson.error || basesJson.error || "Erro ao carregar remanejamentos.");
            }

            setBases(basesJson.data.filter((base: Base) => base.isActive));
            setAssignments(assignmentsJson.data.filter((assignment: Assignment) => ACTIONABLE_STATUSES.includes(assignment.status)));
        } catch (error) {
            setMessage({
                type: "error",
                text: error instanceof Error ? error.message : "Erro ao carregar remanejamentos.",
            });
        } finally {
            setLoading(false);
        }
    }, [weekEnd, weekStart]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!highlightedAssignmentId || assignments.length === 0 || modalAssignment || closedHighlighted) return;
        const highlighted = assignments.find((assignment) => assignment.id === highlightedAssignmentId);
        if (highlighted) {
            setModalAssignment(highlighted);
            setTargetBaseId(highlighted.baseId);
            setReason("");
            setAuthorized(false);
        }
    }, [assignments, highlightedAssignmentId, modalAssignment, closedHighlighted]);

    const filteredAssignments = useMemo(() => {
        const query = search.trim().toLowerCase();
        return assignments.filter((assignment) => {
            if (baseFilter && assignment.baseId !== baseFilter) return false;
            if (statusFilter && assignment.status !== statusFilter) return false;
            if (!query) return true;
            return [assignment.internName, assignment.baseCode, assignment.baseName, assignment.facultyAbbr]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(query));
        });
    }, [assignments, baseFilter, search, statusFilter]);

    const assignmentsByBase = useMemo(() => {
        const grouped = new Map<string, Assignment[]>();
        for (const assignment of filteredAssignments) {
            if (!grouped.has(assignment.baseId)) grouped.set(assignment.baseId, []);
            grouped.get(assignment.baseId)!.push(assignment);
        }
        for (const [, list] of grouped) {
            list.sort((a, b) => {
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                if (a.period !== b.period) return a.period.localeCompare(b.period);
                return a.internName.localeCompare(b.internName);
            });
        }
        return grouped;
    }, [filteredAssignments]);

    const visibleBases = useMemo(() => {
        return bases
            .filter((base) => assignmentsByBase.has(base.id) || !baseFilter || base.id === baseFilter)
            .sort((a, b) => a.code.localeCompare(b.code));
    }, [assignmentsByBase, baseFilter, bases]);

    function openModal(assignment: Assignment) {
        setModalAssignment(assignment);
        setTargetBaseId(assignment.baseId);
        setReason("");
        setAuthorized(false);
        setMessage(null);
    }

    function closeModal() {
        setModalAssignment(null);
        setTargetBaseId("");
        setReason("");
        setAuthorized(false);
        setClosedHighlighted(true);

        const url = new URL(window.location.href);
        if (url.searchParams.has("assignmentId")) {
            url.searchParams.delete("assignmentId");
            router.replace(`${pathname}${url.search}`);
        }
    }

    async function submitReassignment() {
        if (!modalAssignment || !targetBaseId) return;

        setSaving(true);
        setMessage(null);
        try {
            const res = await fetch("/taximetro/api/assignments/reassign", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    assignmentId: modalAssignment.id,
                    newBaseId: targetBaseId,
                    reason: reason.trim() || undefined,
                    authorized: true,
                }),
            });
            const json = await res.json();
            if (!json.success) {
                throw new Error(json.error || "Erro ao remanejar interno.");
            }

            setMessage({ type: "success", text: "Remanejamento salvo com sucesso." });
            closeModal();
            await load();
        } catch (error) {
            setMessage({
                type: "error",
                text: error instanceof Error ? error.message : "Erro ao remanejar interno.",
            });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <p className="text-sm font-medium text-accent-600">Operação</p>
                    <h1 className="text-2xl font-semibold text-slate-900">Remanejamento de Bases</h1>
                    <p className="text-sm text-slate-500">
                        Visualize quem está em cada base e remaneje rapidamente quando houver necessidade operacional, com rastreio para coordenação.
                    </p>
                </div>

                <div className="flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                    <Button variant="ghost" size="icon" onClick={() => setWeekStart(plusDays(weekStart, -7))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="min-w-44 px-2 text-center">
                        <p className="text-xs uppercase tracking-wide text-slate-400">Semana</p>
                        <p className="text-sm font-semibold text-slate-900">{formatDate(weekStart)} a {formatDate(weekEnd)}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setWeekStart(plusDays(weekStart, 7))}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[1.2fr,0.8fr,0.8fr]">
                <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Buscar interno, base ou faculdade"
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white"
                    />
                </label>

                <select
                    value={baseFilter}
                    onChange={(event) => setBaseFilter(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white"
                >
                    <option value="">Todas as bases</option>
                    {bases.map((base) => (
                        <option key={base.id} value={base.id}>{base.code} - {base.name}</option>
                    ))}
                </select>

                <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white"
                >
                    <option value="">Todos os status</option>
                    <option value="SCHEDULED">Agendado</option>
                    <option value="CONFIRMED">Confirmado</option>
                    <option value="CHECKED_IN">Check-in</option>
                </select>
            </div>

            {message && (
                <div className={`rounded-xl px-4 py-3 text-sm ${message.type === "success" ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "border border-red-200 bg-red-50 text-red-700"}`}>
                    {message.text}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500 shadow-sm">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando remanejamentos...
                </div>
            ) : visibleBases.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
                    Nenhum plantão disponível para remanejamento nesta semana com os filtros atuais.
                </div>
            ) : (
                <div className="grid gap-4 xl:grid-cols-2">
                    {visibleBases.map((base) => {
                        const baseAssignments = assignmentsByBase.get(base.id) ?? [];
                        return (
                            <section key={base.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{base.type}</p>
                                        <h2 className="text-lg font-semibold text-slate-900">{base.code}</h2>
                                        <p className="text-sm text-slate-500">{base.name}</p>
                                    </div>
                                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                                        {baseAssignments.length} plant{baseAssignments.length === 1 ? "ão" : "ões"}
                                    </div>
                                </div>

                                <div className="mt-4 space-y-3">
                                    {baseAssignments.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                                            Nenhum interno filtrado nesta base.
                                        </div>
                                    ) : baseAssignments.map((assignment) => {
                                        const highlighted = assignment.id === highlightedAssignmentId;
                                        return (
                                            <div key={assignment.id} className={`rounded-xl border p-3 transition ${highlighted ? "border-accent-300 bg-accent-50/50" : "border-slate-200 bg-slate-50/60"}`}>
                                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                                    <div className="space-y-1">
                                                        <p className="text-sm font-semibold text-slate-900">{assignment.internName}</p>
                                                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                            <span>{formatDate(assignment.date)}</span>
                                                            <span>{periodLabel(assignment.period)}</span>
                                                            <span>{assignment.facultyAbbr}</span>
                                                            {assignment.checkinStatus && <span>Check-in {assignment.checkinStatus.toLowerCase()}</span>}
                                                        </div>
                                                        <StatusBadge status={assignment.status} />
                                                    </div>

                                                    <Button size="sm" variant="outline" onClick={() => openModal(assignment)}>
                                                        <ArrowRightLeft className="h-4 w-4" /> Remanejar
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            {modalAssignment && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-950/45" onClick={closeModal} />
                    <div className="relative z-10 w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
                        <div className="space-y-1 border-b border-slate-100 pb-4">
                            <p className="text-sm font-medium text-accent-600">Remanejar plantão</p>
                            <h3 className="text-xl font-semibold text-slate-900">{modalAssignment.internName}</h3>
                            <p className="text-sm text-slate-500">
                                {modalAssignment.baseCode} - {modalAssignment.baseName} · {formatDate(modalAssignment.date)} · {periodLabel(modalAssignment.period)}
                            </p>
                        </div>

                        <div className="mt-5 space-y-4">
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                <div className="flex items-center gap-2 font-medium text-slate-700">
                                    <MapPin className="h-4 w-4" /> Base atual: {modalAssignment.baseCode}
                                </div>
                                <p className="mt-1 text-xs text-slate-500">{modalAssignment.baseName}</p>
                            </div>

                            {modalAssignment.status === "CHECKED_IN" && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                    <div className="flex items-center gap-2 font-medium">
                                        <TriangleAlert className="h-4 w-4" /> Remanejamento excepcional após check-in validado
                                    </div>
                                    <p className="mt-1 text-xs text-amber-700">
                                        Neste caso o motivo é obrigatório para manter o histórico operacional e a auditoria.
                                    </p>
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Nova base</label>
                                <select
                                    value={targetBaseId}
                                    onChange={(event) => setTargetBaseId(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white"
                                >
                                    {bases.map((base) => (
                                        <option key={base.id} value={base.id}>{base.code} - {base.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-sm font-medium text-slate-700">Motivo</label>
                                <textarea
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    rows={4}
                                    placeholder={modalAssignment.status === "CHECKED_IN" ? "Explique o remanejamento excepcional" : "Opcional, mas recomendado"}
                                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white"
                                />
                            </div>

                            <label className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                                <input
                                    type="checkbox"
                                    checked={authorized}
                                    onChange={(event) => setAuthorized(event.target.checked)}
                                    className="mt-0.5 h-4 w-4 rounded border-blue-300 text-blue-600"
                                />
                                <span>
                                    Confirmo que tenho autorização para este remanejamento. Um alerta será exibido para a coordenação e o plantão ficará marcado como remanejado nos painéis.
                                </span>
                            </label>
                        </div>

                        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <Button variant="outline" onClick={closeModal} disabled={saving}>Cancelar</Button>
                            <Button onClick={submitReassignment} disabled={saving || !authorized || !targetBaseId || targetBaseId === modalAssignment.baseId}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                                Confirmar remanejamento
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <p className="text-xs text-slate-400">
                {scope === "admin"
                    ? "Coordenação vê toda a operação. Líderes enxergam apenas assignments da própria faculdade pela API."
                    : "Esta visão já respeita o recorte da sua faculdade e só mostra plantões remanejáveis nesta semana."}
            </p>
        </div>
    );
}