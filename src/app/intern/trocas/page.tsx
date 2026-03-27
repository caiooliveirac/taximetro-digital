"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useImpersonate } from "@/components/impersonate/impersonate-provider";
import {
  Send, CheckCircle, AlertCircle, ArrowLeftRight,
  Trash2, PlusCircle, RefreshCw, Sun, Moon, X,
  HandshakeIcon, Clock, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getBaseStyle, getPeriodStyle } from "@/lib/base-colors";
import { localDateStr } from "@/lib/utils";

/* ═══════════ Types ═══════════ */

type Assignment = {
  id: string; baseCode: string; baseName: string; baseType?: string;
  date: string; period: string; status: string;
};
type Slot = {
  baseId: string; baseCode: string; baseName: string; baseType?: string;
  dayOfWeek: string; period: string; available: number; nextDate: string;
  capacity: number; filled: number;
};
type Request = {
  id: string; type: string; status: string; createdAt: string;
  requesterId: string; requesterName: string;
  assignmentId: string | null; assignmentDate: string | null;
  assignmentPeriod: string | null; baseCode: string | null;
  baseName: string | null; baseType: string | null;
  targetInternId: string | null; targetInternName: string | null;
  targetAssignmentId: string | null; targetAssignmentDate: string | null;
  targetAssignmentPeriod: string | null; targetBaseCode: string | null;
  targetBaseName: string | null;
  extraBaseId: string | null; extraBaseCode: string | null;
  extraBaseName: string | null; extraDate: string | null;
  extraPeriod: string | null;
  reviewNotes: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente", APPROVED: "Aprovado", COMPLETED: "Concluído",
  REJECTED: "Rejeitado", ESCALATED: "Escalado", OPEN: "Aberta",
  CANCELLED: "Cancelada",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  OPEN: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  REJECTED: "bg-red-50 text-red-700 ring-1 ring-red-200",
  ESCALATED: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  CANCELLED: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};
const DAY_LABEL: Record<string, string> = { MON: "Seg", TUE: "Ter", WED: "Qua", THU: "Qui", FRI: "Sex", SAT: "Sáb", SUN: "Dom" };

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function PeriodIcon({ period }: { period: string }) {
  return period === "DAY"
    ? <Sun className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.5} />
    : <Moon className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />;
}

/* ═══════════ Component ═══════════ */

export default function InternTrocas() {
  const { data: session } = useSession();
  const { target: impersonateTarget } = useImpersonate();
  const userId = impersonateTarget?.userId ?? session?.user?.id;

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [myRequests, setMyRequests] = useState<Request[]>([]);
  const [openSwaps, setOpenSwaps] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"DROP" | "EXTRA" | "SWAP" | "HISTORY">("SWAP");
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* ── Drop state ── */
  const [dropAssignmentId, setDropAssignmentId] = useState("");

  /* ── Extra state ── */
  const [extraSlot, setExtraSlot] = useState<{ baseId: string; date: string; period: string } | null>(null);

  /* ── Swap state ── */
  const [swapAssignmentId, setSwapAssignmentId] = useState("");
  const [proposeTarget, setProposeTarget] = useState<Request | null>(null);
  const [proposeAssignmentId, setProposeAssignmentId] = useState("");

  const load = useCallback(async () => {
    try {
      const from = localDateStr();
      const to = localDateStr(new Date(Date.now() + 30 * 86400000));
      const [aRes, sRes, rRes, osRes] = await Promise.all([
        fetch(`/taximetro/api/assignments?from=${from}&to=${to}`),
        fetch("/taximetro/api/slots/available"),
        fetch("/taximetro/api/requests"),
        fetch("/taximetro/api/requests?scope=open-swaps"),
      ]);
      const [aJson, sJson, rJson, osJson] = await Promise.all([aRes.json(), sRes.json(), rRes.json(), osRes.json()]);
      if (aJson.success) setAssignments(aJson.data.filter((a: Assignment) => ["SCHEDULED", "CONFIRMED"].includes(a.status)));
      if (sJson.success) setSlots(sJson.data.filter((s: Slot) => s.available > 0));
      if (rJson.success) setMyRequests(rJson.data);
      if (osJson.success) setOpenSwaps(osJson.data);
    } catch {
      setMsg({ type: "error", text: "Erro ao carregar dados." });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* ── API helpers ── */
  async function apiPost(body: Record<string, string>) {
    setMsg(null); setSubmitting(true);
    try {
      const res = await fetch("/taximetro/api/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.success) { setMsg({ type: "success", text: "Solicitação enviada!" }); load(); }
      else setMsg({ type: "error", text: json.error || "Erro." });
    } catch { setMsg({ type: "error", text: "Erro de conexão." }); }
    setSubmitting(false);
  }

  async function apiPatch(body: Record<string, string>) {
    setMsg(null); setSubmitting(true);
    try {
      const res = await fetch("/taximetro/api/requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.success) { setMsg({ type: "success", text: "Ação realizada!" }); load(); }
      else setMsg({ type: "error", text: json.error || "Erro." });
    } catch { setMsg({ type: "error", text: "Erro de conexão." }); }
    setSubmitting(false);
  }

  /* ── Submit handlers ── */
  function submitDrop() { if (dropAssignmentId) apiPost({ type: "DROP_SHIFT", assignmentId: dropAssignmentId }); }
  function submitExtra() {
    if (extraSlot) apiPost({ type: "EXTRA_SHIFT", extraBaseId: extraSlot.baseId, extraDate: extraSlot.date, extraPeriod: extraSlot.period });
  }
  function submitSwapOffer() { if (swapAssignmentId) apiPost({ type: "SWAP", assignmentId: swapAssignmentId }); }
  function submitSwapPropose() {
    if (proposeTarget && proposeAssignmentId) apiPatch({ id: proposeTarget.id, action: "propose", assignmentId: proposeAssignmentId });
    setProposeTarget(null); setProposeAssignmentId("");
  }
  function confirmSwap(id: string) { apiPatch({ id, action: "confirm" }); }
  function rejectProposal(id: string) { apiPatch({ id, action: "reject_proposal" }); }
  function cancelRequest(id: string) { apiPatch({ id, action: "cancel" }); }

  /* ── Derived ── */
  const activeSwaps = myRequests.filter((r) => r.type === "SWAP" && ["OPEN", "PENDING"].includes(r.status));
  const activeDrops = myRequests.filter((r) => r.type === "DROP_SHIFT" && ["PENDING"].includes(r.status));
  const activeExtras = myRequests.filter((r) => r.type === "EXTRA_SHIFT" && ["PENDING"].includes(r.status));
  const history = myRequests.filter((r) => ["COMPLETED", "REJECTED", "CANCELLED"].includes(r.status));

  // Assignments not already involved in a pending/open request
  const usedAssignmentIds = new Set(
    myRequests
      .filter((r) => ["OPEN", "PENDING"].includes(r.status) && r.assignmentId)
      .map((r) => r.assignmentId),
  );
  const availableAssignments = assignments.filter((a) => !usedAssignmentIds.has(a.id));

  const selectClass = "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

  if (loading) return <p className="text-sm text-slate-400">Carregando...</p>;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">Trocas & Solicitações</h1>

      {/* Tabs */}
      <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
        {([
          ["SWAP", "Trocas", ArrowLeftRight],
          ["DROP", "Descarte", Trash2],
          ["EXTRA", "Extra", PlusCircle],
          ["HISTORY", "Histórico", Clock],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => { setTab(key as typeof tab); setMsg(null); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />{label}
          </button>
        ))}
      </div>

      {/* Message */}
      {msg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${msg.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {msg.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      {/* ═══════ SWAP TAB ═══════ */}
      {tab === "SWAP" && (
        <div className="space-y-5">
          {/* Offer a shift for swap */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ArrowLeftRight className="h-4 w-4 text-blue-500" strokeWidth={1.5} />
              Oferecer Plantão para Troca
            </h2>
            <p className="text-xs text-slate-500">
              Selecione um plantão seu. Colegas da mesma faculdade poderão propor uma troca oferecendo um plantão deles.
            </p>
            <select value={swapAssignmentId} onChange={(e) => setSwapAssignmentId(e.target.value)} className={selectClass}>
              <option value="">Selecionar plantão...</option>
              {availableAssignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.baseCode} — {fmtDate(a.date)} ({a.period === "DAY" ? "Diurno" : "Noturno"})
                </option>
              ))}
            </select>
            <Button onClick={submitSwapOffer} disabled={!swapAssignmentId || submitting} size="sm" className="gap-2">
              <Send className="h-3.5 w-3.5" /> Publicar Oferta
            </Button>
          </section>

          {/* My active swap offers */}
          {activeSwaps.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-900">Minhas Ofertas de Troca</h2>
              {activeSwaps.filter((r) => r.requesterId === userId).map((r) => (
                <div key={r.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <ShiftBadge code={r.baseCode} date={r.assignmentDate} period={r.assignmentPeriod} baseType={r.baseType} />
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  {r.status === "PENDING" && r.targetInternName && (
                    <div className="rounded-lg bg-blue-50 p-2.5 space-y-2">
                      <p className="text-xs text-blue-800">
                        <strong>{r.targetInternName}</strong> propõe trocar por:
                      </p>
                      <ShiftBadge code={r.targetBaseCode} date={r.targetAssignmentDate} period={r.targetAssignmentPeriod} />
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={() => confirmSwap(r.id)} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-700 gap-1.5 text-xs h-7 px-3">
                          <CheckCircle className="h-3 w-3" /> Aceitar
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => rejectProposal(r.id)} disabled={submitting} className="gap-1.5 text-xs h-7 px-3">
                          <X className="h-3 w-3" /> Recusar
                        </Button>
                      </div>
                    </div>
                  )}
                  {r.status === "OPEN" && (
                    <p className="text-xs text-slate-400">Aguardando propostas de colegas...</p>
                  )}
                  <button onClick={() => cancelRequest(r.id)} disabled={submitting} className="text-xs text-red-500 hover:text-red-600">
                    Cancelar oferta
                  </button>
                </div>
              ))}
              {/* Where I'm the target (proposed counter-offer on someone else's swap) */}
              {activeSwaps.filter((r) => r.targetInternId === userId && r.requesterId !== userId).map((r) => (
                <div key={r.id} className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-600">
                      Você propôs troca para <strong>{r.requesterName}</strong>
                    </p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>Seu: <ShiftBadge code={r.targetBaseCode} date={r.targetAssignmentDate} period={r.targetAssignmentPeriod} inline /></span>
                    <ArrowLeftRight className="h-3 w-3 text-slate-400" />
                    <span>Dele: <ShiftBadge code={r.baseCode} date={r.assignmentDate} period={r.assignmentPeriod} inline /></span>
                  </div>
                  <p className="text-[11px] text-slate-400">Aguardando confirmação de {r.requesterName}...</p>
                </div>
              ))}
            </section>
          )}

          {/* Open swaps from colleagues */}
          {openSwaps.length > 0 && (
            <section className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <HandshakeIcon className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />
                Trocas Disponíveis de Colegas
              </h2>
              {openSwaps.map((r) => (
                <div key={r.id} className="rounded-lg border border-emerald-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-slate-900">{r.requesterName}</p>
                      <p className="text-xs text-slate-500">oferece:</p>
                    </div>
                    <ShiftBadge code={r.baseCode} date={r.assignmentDate} period={r.assignmentPeriod} baseType={r.baseType} />
                  </div>
                  {proposeTarget?.id === r.id ? (
                    <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                      <p className="text-xs font-medium text-slate-700">Qual plantão seu você oferece em troca?</p>
                      <select value={proposeAssignmentId} onChange={(e) => setProposeAssignmentId(e.target.value)} className={selectClass}>
                        <option value="">Selecionar...</option>
                        {availableAssignments.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.baseCode} — {fmtDate(a.date)} ({a.period === "DAY" ? "Diurno" : "Noturno"})
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={submitSwapPropose} disabled={!proposeAssignmentId || submitting} className="gap-1.5 text-xs h-7 px-3">
                          <Send className="h-3 w-3" /> Propor Troca
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setProposeTarget(null); setProposeAssignmentId(""); }} className="text-xs h-7 px-3">
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setProposeTarget(r)} className="gap-1.5 text-xs h-7">
                      <ArrowLeftRight className="h-3 w-3" /> Propor Troca
                    </Button>
                  )}
                </div>
              ))}
            </section>
          )}

          {activeSwaps.length === 0 && openSwaps.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">Nenhuma troca ativa. Publique uma oferta ou aguarde colegas!</p>
          )}
        </div>
      )}

      {/* ═══════ DROP TAB ═══════ */}
      {tab === "DROP" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Trash2 className="h-4 w-4 text-red-500" strokeWidth={1.5} />
              Solicitar Descarte de Plantão
            </h2>
            <p className="text-xs text-slate-500">
              Selecione o plantão que deseja devolver. O líder de escala analisará sua solicitação.
            </p>
            <select value={dropAssignmentId} onChange={(e) => setDropAssignmentId(e.target.value)} className={selectClass}>
              <option value="">Selecionar plantão...</option>
              {availableAssignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.baseCode} — {fmtDate(a.date)} ({a.period === "DAY" ? "Diurno" : "Noturno"})
                </option>
              ))}
            </select>
            <Button onClick={submitDrop} disabled={!dropAssignmentId || submitting} size="sm" variant="destructive" className="gap-2">
              <Send className="h-3.5 w-3.5" /> Solicitar Descarte
            </Button>
          </section>

          {activeDrops.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700">Solicitações Pendentes</h2>
              {activeDrops.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <ShiftBadge code={r.baseCode} date={r.assignmentDate} period={r.assignmentPeriod} baseType={r.baseType} />
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* ═══════ EXTRA TAB ═══════ */}
      {tab === "EXTRA" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <PlusCircle className="h-4 w-4 text-emerald-500" strokeWidth={1.5} />
              Solicitar Plantão Extra
            </h2>
            <p className="text-xs text-slate-500">
              Selecione uma vaga disponível da sua faculdade. O líder analisará sua solicitação.
            </p>
            {slots.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {slots.map((s, i) => {
                  const sel = extraSlot?.baseId === s.baseId && extraSlot?.date === s.nextDate && extraSlot?.period === s.period;
                  const bs = getBaseStyle(s.baseType);
                  const ps = getPeriodStyle(s.period);
                  return (
                    <button key={i} onClick={() => setExtraSlot(sel ? null : { baseId: s.baseId, date: s.nextDate, period: s.period })}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${sel ? "border-accent-500 bg-accent-50 ring-1 ring-accent-500" : `${bs.border} bg-white hover:bg-slate-50`}`}>
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${bs.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">{s.baseCode} — {s.baseName}</p>
                        <p className="text-xs text-slate-500">{DAY_LABEL[s.dayOfWeek]} · {fmtDate(s.nextDate)} · {s.available} vaga{s.available > 1 ? "s" : ""}</p>
                      </div>
                      <div className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${ps.bg} ${ps.text}`}>
                        <PeriodIcon period={s.period} />{ps.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-slate-400">Nenhuma vaga disponível no momento.</p>
            )}
            {extraSlot && (
              <Button onClick={submitExtra} disabled={submitting} size="sm" className="gap-2">
                <Send className="h-3.5 w-3.5" /> Solicitar Vaga
              </Button>
            )}
          </section>

          {activeExtras.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700">Solicitações Pendentes</h2>
              {activeExtras.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <div className="text-sm">
                    <span className="font-medium text-slate-900">{r.extraBaseCode}</span>
                    <span className="text-slate-500"> · {r.extraDate ? fmtDate(r.extraDate) : ""} · {r.extraPeriod === "DAY" ? "Diurno" : "Noturno"}</span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      {/* ═══════ HISTORY TAB ═══════ */}
      {tab === "HISTORY" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {history.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {history.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {r.type === "SWAP" ? "Troca" : r.type === "EXTRA_SHIFT" ? "Extra" : "Descarte"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.type === "EXTRA_SHIFT"
                        ? `${r.extraBaseCode} · ${r.extraDate ? fmtDate(r.extraDate) : ""}`
                        : r.baseCode && r.assignmentDate
                          ? `${r.baseCode} · ${fmtDate(r.assignmentDate)}`
                          : "—"
                      }
                    </p>
                    {r.reviewNotes && <p className="text-[11px] text-slate-400 mt-0.5">{r.reviewNotes}</p>}
                  </div>
                  <div className="text-right">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    <p className="text-[11px] text-slate-400 mt-0.5">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">Nenhuma solicitação no histórico.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════ Shift badge component ═══════════ */

function ShiftBadge({ code, date, period, baseType, inline }: {
  code: string | null; date: string | null; period: string | null; baseType?: string | null; inline?: boolean;
}) {
  if (!code || !date || !period) return <span className="text-xs text-slate-400">—</span>;
  const bs = getBaseStyle(baseType ?? undefined);
  const ps = getPeriodStyle(period);
  if (inline) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${bs.dot}`} />
        <span className="font-medium">{code}</span>
        <span>{fmtDate(date)}</span>
        <PeriodIcon period={period} />
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${bs.dot}`} />
      <div>
        <p className="text-sm font-medium text-slate-900">{code}</p>
        <p className="text-xs text-slate-500">{fmtDate(date)}</p>
      </div>
      <div className={`ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${ps.bg} ${ps.text}`}>
        <PeriodIcon period={period} />{ps.label}
      </div>
    </div>
  );
}
