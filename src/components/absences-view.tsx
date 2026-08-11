"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays, FileText, RefreshCw, Sun, Users, XCircle, Moon, ArrowRight, ClipboardCheck } from "lucide-react";
import { AbsenceJustificationDialog } from "@/components/absence-justification-dialog";
import { InternDrawer } from "@/components/admin/intern-drawer";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBaseStyle, getPeriodStyle, baseViewIndex } from "@/lib/base-colors";
import { localDateStr } from "@/lib/utils";

type Assignment = {
    id: string;
    internId: string;
    internName: string;
    facultyAbbr: string;
    baseCode: string;
    baseName: string;
    baseType?: string;
    date: string;
    period: string;
    status: string;
    absenceJustification?: string | null;
    absenceJustificationActor?: string | null;
    absenceJustificationAt?: string | null;
    internArchived?: boolean | null;
};

// Falta é pendência operacional, não histórico: some da aba após 60 dias
// ou assim que a turma do interno é arquivada (o que vier primeiro).
const MAX_ABSENCE_AGE_DAYS = 60;

type AbsencesViewProps = {
    scope: "admin" | "leader";
    title: string;
    description: string;
};

type ComplianceRow = {
    userId: string;
    futureScheduled: number;
    rawDeficit: number;
    netDeficit: number;
    thisWeekAbsent: number;
    status: "ok" | "compensating" | "partial" | "deficit";
};

type ActionPlan = {
    kind: "justify" | "allocate" | "monitor" | "review";
    title: string;
    detail: string;
    badgeClassName: string;
    href: string | null;
    hrefLabel: string | null;
};

function formatJustificationActor(actor: string | null | undefined) {
    if (actor === "INTERN") return "Aluno";
    if (actor === "LEADER") return "Líder";
    if (actor === "COORDINATOR") return "Coordenação";
    return "";
}

function getScaleHref(scope: "admin" | "leader", assignment: Assignment) {
    if (scope === "leader") return "/leader/escala";
    if (assignment.baseType === "CENTRAL") return "/admin/escalas/cru";
    if (assignment.baseType === "CRL") return "/admin/escalas/crl";
    return "/admin/escalas/usa";
}

function buildActionPlan(scope: "admin" | "leader", assignment: Assignment, compliance: ComplianceRow | undefined): ActionPlan {
    if (!assignment.absenceJustification?.trim()) {
        return {
            kind: "justify",
            title: "Cobrar justificativa",
            detail: "Registrar o motivo da falta antes de decidir reposição.",
            badgeClassName: "bg-amber-50 text-amber-700 border border-amber-200",
            href: null,
            hrefLabel: null,
        };
    }

    const scaleHref = getScaleHref(scope, assignment);

    if (!compliance) {
        return {
            kind: "review",
            title: "Revisar cobertura",
            detail: `Falta justificada em ${assignment.baseCode}. Confirme na escala se a cobertura foi recomposta.`,
            badgeClassName: "bg-slate-50 text-slate-700 border border-slate-200",
            href: scaleHref,
            hrefLabel: "Abrir escala",
        };
    }

    if (compliance.status === "compensating") {
        return {
            kind: "monitor",
            title: "Acompanhar compensação",
            detail: `${compliance.futureScheduled} plantão(ões) futuro(s) já ajudam a compensar essa falta.`,
            badgeClassName: "bg-emerald-50 text-emerald-700 border border-emerald-200",
            href: scaleHref,
            hrefLabel: "Ver escala",
        };
    }

    if (compliance.status === "partial") {
        return {
            kind: "allocate",
            title: "Alocar reposição parcial",
            detail: `Ainda faltam ${Math.max(1, compliance.netDeficit)} plantão(ões) para compensar o déficit atual.`,
            badgeClassName: "bg-orange-50 text-orange-700 border border-orange-200",
            href: scaleHref,
            hrefLabel: "Abrir escala",
        };
    }

    if (compliance.status === "deficit" || compliance.futureScheduled === 0) {
        return {
            kind: "allocate",
            title: "Alocar reposição",
            detail: `Sem cobertura futura suficiente. Reponha ${assignment.baseCode} no turno ${assignment.period === "DAY" ? "diurno" : "noturno"}.`,
            badgeClassName: "bg-red-50 text-red-700 border border-red-200",
            href: scaleHref,
            hrefLabel: "Abrir escala",
        };
    }

    return {
        kind: "review",
        title: "Revisar próxima escala",
        detail: compliance.thisWeekAbsent > 0
            ? "Confira se a semana já foi recomposta após a ausência."
            : "Revise a programação futura do interno para manter a meta.",
        badgeClassName: "bg-sky-50 text-sky-700 border border-sky-200",
        href: scaleHref,
        hrefLabel: "Ver escala",
    };
}

export function AbsencesView({ scope, title, description }: AbsencesViewProps) {
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [internDrawer, setInternDrawer] = useState<{ id: string; name: string; facultyAbbr?: string } | null>(null);
    const [complianceRows, setComplianceRows] = useState<ComplianceRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [minFromDate] = useState(() => localDateStr(new Date(Date.now() - MAX_ABSENCE_AGE_DAYS * 86400000)));
    const [fromDate, setFromDate] = useState(minFromDate);
    const [toDate, setToDate] = useState(() => localDateStr());
    const [search, setSearch] = useState("");
    const [filterBase, setFilterBase] = useState("");
    const [filterFaculty, setFilterFaculty] = useState("");
    const [filterPeriod, setFilterPeriod] = useState("");
    const [filterJustification, setFilterJustification] = useState<"ALL" | "JUSTIFIED" | "PENDING">("ALL");
    const [justificationAssignment, setJustificationAssignment] = useState<Assignment | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const from = fromDate < minFromDate ? minFromDate : fromDate;
            const [assignmentsRes, complianceRes] = await Promise.all([
                fetch(`/taximetro/api/assignments?from=${from}&to=${toDate}`),
                fetch("/taximetro/api/compliance"),
            ]);
            const [assignmentsJson, complianceJson] = await Promise.all([assignmentsRes.json(), complianceRes.json()]);
            if (!assignmentsJson.success) {
                setAssignments([]);
                setComplianceRows([]);
                setError("Não foi possível carregar as faltas.");
                return;
            }

            setAssignments((assignmentsJson.data as Assignment[]).filter(
                (assignment) => assignment.status === "ABSENT" && !assignment.internArchived,
            ));
            setComplianceRows(complianceJson.success ? complianceJson.data : []);
            setError("");
        } catch {
            setAssignments([]);
            setComplianceRows([]);
            setError("Não foi possível carregar as faltas.");
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate, minFromDate]);

    useEffect(() => {
        load();
        const interval = setInterval(load, 30000);
        return () => clearInterval(interval);
    }, [load]);

    function handleJustificationSaved(assignmentId: string, data: {
        absenceJustification: string | null;
        absenceJustificationActor: string | null;
        absenceJustificationAt: string | null;
    }) {
        setAssignments((current) => current.map((assignment) => assignment.id === assignmentId ? { ...assignment, ...data } : assignment));
    }

    const bases = [...new Set(assignments.map((assignment) => assignment.baseCode))].sort((left, right) => baseViewIndex(left) - baseViewIndex(right));
    const faculties = [...new Set(assignments.map((assignment) => assignment.facultyAbbr).filter(Boolean))].sort();
    const justifiedCount = assignments.filter((assignment) => Boolean(assignment.absenceJustification?.trim())).length;
    const pendingJustificationCount = assignments.length - justifiedCount;
    const impactedInterns = new Set(assignments.map((assignment) => assignment.internId)).size;
    const complianceByIntern = new Map(complianceRows.map((row) => [row.userId, row]));

    const assignmentsWithAction = assignments.map((assignment) => ({
        assignment,
        actionPlan: buildActionPlan(scope, assignment, complianceByIntern.get(assignment.internId)),
    }));
    const needsAllocationCount = assignmentsWithAction.filter(({ actionPlan }) => actionPlan.kind === "allocate").length;
    const monitoringCount = assignmentsWithAction.filter(({ actionPlan }) => actionPlan.kind === "monitor").length;

    const filtered = assignmentsWithAction
        .filter(({ assignment }) => {
            const matchesSearch = !search || assignment.internName.toLowerCase().includes(search.toLowerCase()) || assignment.baseCode.toLowerCase().includes(search.toLowerCase());
            const matchesBase = !filterBase || assignment.baseCode === filterBase;
            const matchesFaculty = !filterFaculty || assignment.facultyAbbr === filterFaculty;
            const matchesPeriod = !filterPeriod || assignment.period === filterPeriod;
            const matchesJustification = filterJustification === "ALL"
                || (filterJustification === "JUSTIFIED" && Boolean(assignment.absenceJustification?.trim()))
                || (filterJustification === "PENDING" && !assignment.absenceJustification?.trim());
            return matchesSearch && matchesBase && matchesFaculty && matchesPeriod && matchesJustification;
        })
        .sort((left, right) => {
            const leftJustificationRank = left.assignment.absenceJustification?.trim() ? 1 : 0;
            const rightJustificationRank = right.assignment.absenceJustification?.trim() ? 1 : 0;
            if (leftJustificationRank !== rightJustificationRank) return leftJustificationRank - rightJustificationRank;
            const leftActionRank = left.actionPlan.kind === "allocate" ? 0 : left.actionPlan.kind === "justify" ? 1 : left.actionPlan.kind === "review" ? 2 : 3;
            const rightActionRank = right.actionPlan.kind === "allocate" ? 0 : right.actionPlan.kind === "justify" ? 1 : right.actionPlan.kind === "review" ? 2 : 3;
            if (leftActionRank !== rightActionRank) return leftActionRank - rightActionRank;
            const leftAssignment = left.assignment;
            const rightAssignment = right.assignment;
            if (leftAssignment.date !== rightAssignment.date) return rightAssignment.date.localeCompare(leftAssignment.date);
            const baseDelta = baseViewIndex(leftAssignment.baseCode) - baseViewIndex(rightAssignment.baseCode);
            if (baseDelta !== 0) return baseDelta;
            if (leftAssignment.period !== rightAssignment.period) return leftAssignment.period === "DAY" ? -1 : 1;
            return leftAssignment.internName.localeCompare(rightAssignment.internName);
        });

    const selectCls = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20";

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
                    <p className="text-sm text-slate-500">{description}</p>
                </div>
                <span className="flex items-center gap-1 text-xs text-slate-400">
                    <RefreshCw className="h-3 w-3" strokeWidth={1.5} /> 30s
                </span>
            </div>

            {loading ? (
                <TableSkeleton rows={6} cols={7} />
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
                        <MetricCard label="Faltas" value={assignments.length} icon={XCircle} severity={assignments.length > 0 ? "danger" : "default"} />
                        <MetricCard label="Internos afetados" value={impactedInterns} icon={Users} />
                        <MetricCard label="Sem justificativa" value={pendingJustificationCount} icon={FileText} severity={pendingJustificationCount > 0 ? "warning" : "success"} />
                        <MetricCard label="Precisam alocação" value={needsAllocationCount} icon={ClipboardCheck} severity={needsAllocationCount > 0 ? "warning" : "default"} />
                        <MetricCard label="Já compensando" value={monitoringCount} icon={CalendarDays} severity={monitoringCount > 0 ? "success" : "default"} />
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">
                        <p className="font-medium text-slate-900">Leitura operacional</p>
                        <p className="mt-1">
                            A fila prioriza faltas sem justificativa e, entre as justificadas, destaca quem ainda precisa de reposição. A coluna de ação cruza a ausência com o compliance do interno para sugerir se basta acompanhar ou se já é hora de abrir a escala e recompor cobertura.
                        </p>
                    </div>

                    <div className="grid gap-2 lg:grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(0,0.8fr))]">
                        <Input placeholder="Buscar interno ou base..." value={search} onChange={(event) => setSearch(event.target.value)} />
                        <input type="date" min={minFromDate} value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={selectCls} />
                        <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className={selectCls} />
                        <select value={filterBase} onChange={(event) => setFilterBase(event.target.value)} className={selectCls}>
                            <option value="">Todas as bases</option>
                            {bases.map((base) => <option key={base} value={base}>{base}</option>)}
                        </select>
                        <select value={filterFaculty} onChange={(event) => setFilterFaculty(event.target.value)} className={selectCls}>
                            <option value="">Todas faculdades</option>
                            {faculties.map((faculty) => <option key={faculty} value={faculty}>{faculty}</option>)}
                        </select>
                        <div className="grid grid-cols-2 gap-2">
                            <select value={filterPeriod} onChange={(event) => setFilterPeriod(event.target.value)} className={selectCls}>
                                <option value="">Todos turnos</option>
                                <option value="DAY">Diurno</option>
                                <option value="NIGHT">Noturno</option>
                            </select>
                            <select value={filterJustification} onChange={(event) => setFilterJustification(event.target.value as "ALL" | "JUSTIFIED" | "PENDING")} className={selectCls}>
                                <option value="ALL">Todas</option>
                                <option value="PENDING">Sem justificativa</option>
                                <option value="JUSTIFIED">Justificadas</option>
                            </select>
                        </div>
                    </div>

                    {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

                    <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Data</TableHead>
                                    <TableHead>Interno</TableHead>
                                    <TableHead>Faculdade</TableHead>
                                    <TableHead>Base</TableHead>
                                    <TableHead>Turno</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Justificativa</TableHead>
                                    <TableHead>Próxima ação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map(({ assignment, actionPlan }) => {
                                    const baseStyle = getBaseStyle(assignment.baseType);
                                    const periodStyle = getPeriodStyle(assignment.period);
                                    return (
                                        <TableRow key={assignment.id} className="bg-red-50/60">
                                            <TableCell className="text-slate-900">{new Date(`${assignment.date}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell>
                                            <TableCell className="font-medium text-slate-900">
                                                <button
                                                    type="button"
                                                    onClick={() => setInternDrawer({ id: assignment.internId, name: assignment.internName, facultyAbbr: assignment.facultyAbbr })}
                                                    className="text-left underline-offset-2 hover:underline"
                                                    title={`Ver interno: ${assignment.internName}`}
                                                >
                                                    {assignment.internName}
                                                </button>
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-500">{assignment.facultyAbbr}</TableCell>
                                            <TableCell>
                                                <span className="flex items-center gap-1.5 text-slate-900">
                                                    <span className={`inline-block h-2 w-2 rounded-full ${baseStyle.dot}`} />
                                                    {assignment.baseCode} — {assignment.baseName}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${periodStyle.bg} ${periodStyle.text}`}>
                                                    {assignment.period === "DAY" ? <Sun className="h-3 w-3" strokeWidth={1.5} /> : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                                                    {periodStyle.label}
                                                </span>
                                            </TableCell>
                                            <TableCell><StatusBadge status={assignment.status} /></TableCell>
                                            <TableCell>
                                                <div className="space-y-1">
                                                    {assignment.absenceJustification ? (
                                                        <>
                                                            <p className="max-w-[320px] truncate text-xs text-slate-600">{assignment.absenceJustification}</p>
                                                            <p className="text-[11px] text-slate-400">
                                                                {formatJustificationActor(assignment.absenceJustificationActor)}
                                                                {assignment.absenceJustificationAt ? ` · ${new Date(assignment.absenceJustificationAt).toLocaleString("pt-BR")}` : ""}
                                                            </p>
                                                        </>
                                                    ) : (
                                                        <p className="text-xs font-medium text-amber-600">Sem justificativa</p>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setJustificationAssignment(assignment)}
                                                        className="text-xs font-medium text-accent-600 hover:text-accent-500"
                                                    >
                                                        {assignment.absenceJustification ? "Ver ou editar" : "Justificar falta"}
                                                    </button>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="space-y-2">
                                                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${actionPlan.badgeClassName}`}>
                                                        {actionPlan.title}
                                                    </span>
                                                    <p className="max-w-[320px] text-xs text-slate-600">{actionPlan.detail}</p>
                                                    {actionPlan.href && actionPlan.hrefLabel && (
                                                        <Link href={actionPlan.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:text-accent-500">
                                                            {actionPlan.hrefLabel}
                                                            <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.8} />
                                                        </Link>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                        {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhuma falta encontrada para os filtros selecionados.</p>}
                        <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">{filtered.length} de {assignments.length} faltas no intervalo selecionado</div>
                    </div>
                </>
            )}

            <AbsenceJustificationDialog
                assignment={justificationAssignment ? {
                    id: justificationAssignment.id,
                    date: justificationAssignment.date,
                    period: justificationAssignment.period,
                    baseCode: justificationAssignment.baseCode,
                    baseName: justificationAssignment.baseName,
                    absenceJustification: justificationAssignment.absenceJustification,
                    absenceJustificationActor: justificationAssignment.absenceJustificationActor,
                    absenceJustificationAt: justificationAssignment.absenceJustificationAt,
                } : null}
                title="Gerenciar justificativa de falta"
                onClose={() => setJustificationAssignment(null)}
                onSaved={handleJustificationSaved}
            />

            {internDrawer && (
                <InternDrawer
                    internId={internDrawer.id}
                    internName={internDrawer.name}
                    facultyAbbr={internDrawer.facultyAbbr}
                    onClose={() => setInternDrawer(null)}
                />
            )}
        </div>
    );
}