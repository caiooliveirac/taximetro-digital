"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  UserPlus, Link2, Copy, Check, Clock, UserCheck, UserX, Trash2, Target,
  ChevronDown, Calendar, MapPin, Sun, Moon, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { getFacultyStyle } from "@/lib/base-colors";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";

type UserRow = {
  id: string;
  name: string;
  cpf: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  role?: string;
  facultyAbbr: string | null;
  createdAt?: string;
};

type ComplianceRow = {
  userId: string;
  name: string;
  targetShifts: number;
  targetShiftsPerWeek: number;
  totalCompleted: number;
  totalAbsent: number;
  totalDeficit: number;
  totalPct: number | null;
  thisWeekCompleted: number;
  thisWeekScheduled: number;
  thisWeekAbsent: number;
  belowWeeklyTarget: boolean;
  futureScheduled: number;
  rawDeficit: number;
  netDeficit: number;
  status: "ok" | "compensating" | "partial" | "deficit";
};

type AssignmentRow = {
  id: string;
  internId: string;
  baseCode: string;
  baseName: string;
  baseType?: string;
  date: string;
  period: string;
  status: string;
};

type InviteLink = {
  id: string;
  token: string;
  facultyAbbr: string | null;
  isActive: boolean;
  createdAt: string;
};

type Tab = "ativos" | "pendentes" | "convites";

export default function LeaderInternos() {
  const [tab, setTab] = useState<Tab>("ativos");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [compliance, setCompliance] = useState<ComplianceRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [pending, setPending] = useState<UserRow[]>([]);
  const [links, setLinks] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

      const [usersRes, pendingRes, linksRes, complianceRes, assignRes] = await Promise.all([
        fetch("/taximetro/api/admin/users").then((r) => r.json()),
        fetch("/taximetro/api/leader/pendentes").then((r) => r.json()),
        fetch("/taximetro/api/leader/convites").then((r) => r.json()),
        fetch("/taximetro/api/compliance").then((r) => r.json()),
        fetch(`/taximetro/api/assignments?from=${from}&to=${to}`).then((r) => r.json()),
      ]);
      if (usersRes.success) setUsers(usersRes.data.filter((u: UserRow) => u.role === "INTERN" && u.isActive));
      if (pendingRes.success) setPending(pendingRes.data);
      if (linksRes.success) setLinks(linksRes.data.filter((l: InviteLink) => l.isActive));
      if (complianceRes.success) setCompliance(complianceRes.data);
      if (assignRes.success) setAssignments(assignRes.data);
      setError("");
    } catch {
      setError("Erro ao carregar dados. Tente recarregar a página.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function generateLink() {
    try {
      const res = await fetch("/taximetro/api/leader/convites", { method: "POST" });
      const json = await res.json();
      if (json.success) { loadData(); setActionMsg({ type: "success", text: "Link gerado!" }); }
      else setActionMsg({ type: "error", text: json.error || "Erro ao gerar link." });
    } catch {
      setActionMsg({ type: "error", text: "Erro de conexão ao gerar link." });
    }
  }

  async function deactivateLink(id: string) {
    try {
      await fetch(`/taximetro/api/leader/convites?id=${id}`, { method: "DELETE" });
      loadData();
    } catch {
      setActionMsg({ type: "error", text: "Erro ao desativar link." });
    }
  }

  async function handleAction(userId: string, action: "approve" | "reject") {
    setActing(userId);
    try {
      const res = await fetch("/taximetro/api/leader/pendentes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const json = await res.json();
      if (!json.success) setActionMsg({ type: "error", text: json.error || "Erro ao processar." });
      else setActionMsg({ type: "success", text: action === "approve" ? "Interno aprovado!" : "Interno rejeitado." });
      loadData();
    } catch {
      setActionMsg({ type: "error", text: "Erro de conexão." });
    }
    setActing(null);
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/taximetro/registro/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  const filtered = users.filter(
    (u) => !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.cpf.includes(search)
  );

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "ativos", label: "Ativos", count: users.length },
    { key: "pendentes", label: "Pendentes", count: pending.length },
    { key: "convites", label: "Links", count: links.length },
  ];

  if (loading) return <p className="text-slate-500">Carregando...</p>;
  if (error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Internos</h1>
        <Button onClick={generateLink} size="sm" className="gap-2">
          <Link2 className="h-4 w-4" />
          Gerar Link de Convite
        </Button>
      </div>

      {actionMsg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${actionMsg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {actionMsg.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium ${
                t.key === "pendentes" && t.count > 0
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-200 text-slate-500"
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab: Ativos */}
      {tab === "ativos" && (
        <div className="space-y-3">
          <input
            placeholder="Buscar por nome ou CPF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-500/20 focus:border-accent-500"
          />
          <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium text-center">Plantões</th>
                  <th className="px-4 py-3 font-medium text-center">Faltas</th>
                  <th className="px-4 py-3 font-medium text-center hidden sm:table-cell">Progresso</th>
                  <th className="px-4 py-3 font-medium text-center hidden sm:table-cell">Semana</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const c = compliance.find((cr) => cr.userId === u.id);
                  const isExpanded = expandedId === u.id;
                  const internAssignments = isExpanded
                    ? assignments.filter((a) => a.internId === u.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)
                    : [];

                  return (
                    <tr
                      key={u.id}
                      className={`border-b border-slate-100 last:border-0 cursor-pointer transition-colors ${isExpanded ? "bg-slate-50" : "hover:bg-slate-50/50"}`}
                      onClick={() => setExpandedId(isExpanded ? null : u.id)}
                    >
                      <td colSpan={6} className="p-0">
                        {/* Main row content */}
                        <div className="flex items-center">
                          <div className="flex-1 px-4 py-3 min-w-0">
                            <div className="font-medium text-slate-900">{u.name}</div>
                            <div className="text-xs text-slate-400 font-mono">{u.cpf}</div>
                          </div>
                          <div className="px-4 py-3 text-center w-20">
                            {c ? (
                              <span className="text-slate-900 font-medium">{c.totalCompleted}</span>
                            ) : "—"}
                            {c && c.targetShifts > 0 && (
                              <span className="text-slate-400 text-xs">/{c.targetShifts}</span>
                            )}
                          </div>
                          <div className="px-4 py-3 text-center w-16">
                            {c && c.totalAbsent > 0 ? (
                              <span className="text-red-600 font-medium">{c.totalAbsent}</span>
                            ) : (
                              <span className="text-slate-300">0</span>
                            )}
                          </div>
                          <div className="px-4 py-3 hidden sm:block w-28">
                            {c && c.totalPct !== null ? (
                              <div className="mx-auto flex w-24 items-center gap-1.5">
                                <div className="h-2 flex-1 rounded-full bg-slate-100">
                                  <div
                                    className={`h-2 rounded-full transition-all ${c.totalPct >= 100 ? "bg-emerald-500" : c.totalPct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                                    style={{ width: `${c.totalPct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-slate-500 tabular-nums">{c.totalPct}%</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-300 text-center block">—</span>
                            )}
                          </div>
                          <div className="px-4 py-3 text-center hidden sm:block w-28">
                            {c && c.targetShiftsPerWeek > 0 ? (
                              c.status === "ok" ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">
                                  {c.thisWeekCompleted}/{c.targetShiftsPerWeek}
                                </span>
                              ) : c.status === "compensating" ? (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700">
                                  Compensando
                                </span>
                              ) : c.status === "partial" ? (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700">
                                  <Target className="h-3 w-3" strokeWidth={2} />
                                  −{c.netDeficit}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700">
                                  <Target className="h-3 w-3" strokeWidth={2} />
                                  −{c.rawDeficit}
                                </span>
                              )
                            ) : (
                              <span className="text-xs text-slate-300">—</span>
                            )}
                          </div>
                          <div className="px-2 py-3 w-8">
                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`} strokeWidth={1.5} />
                          </div>
                        </div>

                        {/* Expanded detail panel */}
                        {isExpanded && (
                          <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50/50" onClick={(e) => e.stopPropagation()}>
                            {/* Compliance summary */}
                            {c && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Esta semana</p>
                                  <p className="text-lg font-bold text-slate-900">{c.thisWeekScheduled - c.thisWeekAbsent}<span className="text-sm text-slate-400">/{c.targetShiftsPerWeek}</span></p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Realizados</p>
                                  <p className="text-lg font-bold text-slate-900">{c.totalCompleted}<span className="text-sm text-slate-400">/{c.targetShifts}</span></p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Agendados</p>
                                  <p className="text-lg font-bold text-slate-900">{c.futureScheduled}</p>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase">Faltas</p>
                                  <p className={`text-lg font-bold ${c.totalAbsent > 0 ? "text-red-600" : "text-slate-900"}`}>{c.totalAbsent}</p>
                                </div>
                              </div>
                            )}

                            {/* Recent assignments */}
                            <div>
                              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Últimos plantões</h3>
                              {internAssignments.length > 0 ? (
                                <div className="space-y-1">
                                  {internAssignments.map((a) => {
                                    const bs = getBaseStyle(a.baseType);
                                    const ps = getPeriodStyle(a.period);
                                    return (
                                      <div key={a.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm">
                                        <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${bs.dot}`} />
                                        <span className="font-medium text-slate-900 w-14">{a.baseCode}</span>
                                        <span className="text-xs text-slate-500 w-20">
                                          {new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                                        </span>
                                        <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${ps.text}`}>
                                          {a.period === "DAY" ? <Sun className="h-3 w-3" strokeWidth={1.5} /> : <Moon className="h-3 w-3" strokeWidth={1.5} />}
                                          {ps.label}
                                        </span>
                                        <span className="ml-auto"><StatusBadge status={a.status} /></span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">Nenhum plantão nos últimos 30 dias.</p>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                              <Link href="/leader/escala" className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 transition-colors">
                                <Calendar className="h-4 w-4" strokeWidth={1.5} />
                                Alocar na escala
                                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                              </Link>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="flex flex-col items-center py-12 text-slate-400">
                <UserPlus className="h-8 w-8 mb-2" />
                <p className="text-sm">Nenhum interno ativo encontrado.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Pendentes */}
      {tab === "pendentes" && (
        <div className="space-y-3">
          {pending.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <Clock className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum registro pendente de aprovação.</p>
            </div>
          ) : (
            pending.map((u) => (
              <div key={u.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{u.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{u.cpf} · {u.email}</p>
                    {u.phone && <p className="text-xs text-slate-500">{u.phone}</p>}
                    {u.createdAt && (
                      <p className="text-xs text-slate-400 mt-1">
                        Registrado em {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAction(u.id, "reject")}
                      disabled={acting === u.id}
                      className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <UserX className="h-4 w-4" />
                      <span className="hidden sm:inline">Rejeitar</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAction(u.id, "approve")}
                      disabled={acting === u.id}
                      className="gap-1"
                    >
                      <UserCheck className="h-4 w-4" />
                      <span className="hidden sm:inline">Aprovar</span>
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Links de Convite */}
      {tab === "convites" && (
        <div className="space-y-3">
          {links.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <Link2 className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Nenhum link ativo. Clique em &quot;Gerar Link de Convite&quot;.</p>
            </div>
          ) : (
            links.map((link) => {
              const url = `${typeof window !== "undefined" ? window.location.origin : ""}/taximetro/registro/${link.token}`;
              return (
                <div key={link.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs text-slate-500">{url}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Criado em {new Date(link.createdAt).toLocaleDateString("pt-BR")}
                        {link.facultyAbbr && ` · ${link.facultyAbbr}`}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => copyLink(link.token)} className="gap-1">
                        {copied === link.token ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                        {copied === link.token ? "Copiado" : "Copiar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deactivateLink(link.id)}
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
