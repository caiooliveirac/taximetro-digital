"use client";

import { useEffect, useState, useRef } from "react";
import { getFacultyStyle } from "@/lib/base-colors";
import { FileDown } from "lucide-react";

type User = {
  id: string;
  name: string;
  cpf: string;
  email: string;
  phone: string | null;
  registrationCode: string | null;
  isActive: boolean;
  selfie: string | null;
  role: string | null;
  facultyId: string | null;
  facultyAbbr: string | null;
  baseId: string | null;
  baseCode: string | null;
};

type Faculty = { id: string; abbreviation: string };
type Base = { id: string; code: string; name: string };

type HistoryAssignment = {
  id: string;
  date: string;
  period: string;
  assignment_status: string;
  base_code: string;
  base_name: string;
  checkin_status: string | null;
  geo_valid: boolean | null;
  checkin_method: string | null;
  checkin_at: string | null;
  checkout_at: string | null;
};

type HistoryRequest = {
  id: string;
  type: string;
  status: string;
  created_at: string;
  review_notes: string | null;
  assignment_date: string;
  base_code: string;
};

const ROLES = ["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"] as const;
const ROLE_LABEL: Record<string, string> = {
  COORDINATOR: "Coordenador",
  LEADER: "Líder de Escala",
  PRECEPTOR: "Preceptor",
  INTERN: "Interno",
};

const OUTCOME_LABEL: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CHECKED_IN: "Presente",
  CHECKED_OUT: "Finalizado",
  ABSENT: "Ausente",
  CANCELLED: "Cancelado",
};

const OUTCOME_COLOR: Record<string, string> = {
  SCHEDULED: "",
  CONFIRMED: "bg-blue-50",
  CHECKED_IN: "bg-emerald-50",
  CHECKED_OUT: "bg-emerald-50",
  ABSENT: "bg-red-50",
  CANCELLED: "bg-slate-50",
};

function getRowOutcome(a: HistoryAssignment): { label: string; bg: string } {
  if (a.assignment_status === "ABSENT") return { label: "Ausente", bg: "bg-red-50" };
  if (a.geo_valid === false) return { label: "Erro geolocalização", bg: "bg-purple-50" };
  if (a.checkin_status === "EXPIRED") return { label: "TOTP expirado", bg: "bg-violet-50" };
  if (a.checkin_status === "REJECTED") return { label: "Erro QR", bg: "bg-fuchsia-50" };
  return {
    label: OUTCOME_LABEL[a.assignment_status] ?? a.assignment_status,
    bg: OUTCOME_COLOR[a.assignment_status] ?? "",
  };
}

const REQ_TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
const REQ_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", APPROVED: "Aprovada", REJECTED: "Rejeitada" };
const REQ_STATUS_COLOR: Record<string, string> = { PENDING: "bg-amber-50 text-amber-700", APPROVED: "bg-emerald-50 text-emerald-700", REJECTED: "bg-red-50 text-red-700" };

export default function AdminUsuarios() {
  const [users, setUsers] = useState<User[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [bases, setBases] = useState<Base[]>([]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showPending, setShowPending] = useState(false);
  const [history, setHistory] = useState<{ assignments: HistoryAssignment[]; requests: HistoryRequest[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  async function load() {
    const [uRes, fRes, bRes] = await Promise.all([
      fetch("/taximetro/api/admin/users").then((r) => r.json()),
      fetch("/taximetro/api/admin/faculties").then((r) => r.json()),
      fetch("/taximetro/api/admin/bases").then((r) => r.json()),
    ]);
    if (uRes.success) setUsers(uRes.data);
    if (fRes.success) setFaculties(fRes.data);
    if (bRes.success) setBases(bRes.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function loadHistory(userId: string) {
    setHistoryLoading(true);
    const res = await fetch(`/taximetro/api/admin/users/${userId}/history`);
    const json = await res.json();
    if (json.success) setHistory(json.data);
    setHistoryLoading(false);
  }

  function openEdit(user: User) {
    setEditing({ ...user, password: undefined });
    setHistory(null);
    if (user.role === "INTERN") loadHistory(user.id);
  }

  async function save() {
    setError("");
    if (!editing) return;
    const isNew = !editing.id;
    const res = await fetch("/taximetro/api/admin/users", {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    const json = await res.json();
    if (!json.success) { setError(json.error); return; }
    setEditing(null);
    setHistory(null);
    load();
  }

  function formatCpf(value: string) {
    const d = value.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  async function exportPdf() {
    if (!historyRef.current || !editing) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join("");
    printWindow.document.write(`
      <!DOCTYPE html><html><head><title>Histórico — ${editing.name as string}</title>${styles}
      <style>body{padding:24px;font-family:system-ui,sans-serif}@media print{body{padding:12px}}</style>
      </head><body>${historyRef.current.innerHTML}</body></html>
    `);
    printWindow.document.close();
    printWindow.onload = () => { printWindow.print(); };
  }

  const pendingCount = users.filter((u) => !u.isActive).length;

  const filtered = users.filter((u) => {
    if (showPending && u.isActive) return false;
    return u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.cpf.includes(search) ||
      (u.role ?? "").toLowerCase().includes(search.toLowerCase());
  });

  if (loading) return <p className="text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Usuários</h1>
        <div className="flex gap-2">
          {pendingCount > 0 && (
            <button
              onClick={() => setShowPending(!showPending)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                showPending
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
            >
              Pendentes ({pendingCount})
            </button>
          )}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
          <button onClick={() => { setEditing({ name: "", cpf: "", email: "", phone: "", password: "", role: "INTERN", facultyId: "", registrationCode: "" }); setHistory(null); }} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 whitespace-nowrap">
            + Novo
          </button>
        </div>
      </div>

      {editing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <h2 className="font-semibold text-slate-900">{editing.id ? "Editar Usuário" : "Novo Usuário"}</h2>

          {/* Selfie preview for existing users */}
          {!!editing.id && !!(editing as User).selfie && (
            <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
              <img src={(editing as User).selfie!} alt="Selfie" className="h-16 w-16 rounded-full object-cover ring-2 ring-slate-200" />
              <div>
                <p className="text-xs font-medium text-slate-600">Selfie de identificação</p>
                <p className="text-[10px] text-slate-400">Enviada no cadastro</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Inp label="Nome" value={editing.name as string ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
            <Inp label="CPF" value={editing.cpf as string ?? ""} onChange={(v) => setEditing({ ...editing, cpf: formatCpf(v) })} />
            <Inp label="Email" value={editing.email as string ?? ""} onChange={(v) => setEditing({ ...editing, email: v })} />
            <Inp label="Telefone" value={editing.phone as string ?? ""} onChange={(v) => setEditing({ ...editing, phone: v })} />
            <Inp label="Cód. Cadastro" value={editing.registrationCode as string ?? ""} onChange={(v) => setEditing({ ...editing, registrationCode: v })} />
            {!editing.id && <Inp label="Senha" value={editing.password as string ?? ""} onChange={(v) => setEditing({ ...editing, password: v })} />}
            <Sel label="Papel" value={editing.role as string ?? "INTERN"} options={[...ROLES]} labels={ROLES.map((r) => ROLE_LABEL[r])} onChange={(v) => setEditing({ ...editing, role: v })} />
            {(editing.role === "INTERN" || editing.role === "LEADER") && (
              <Sel label="Faculdade" value={editing.facultyId as string ?? ""} options={["", ...faculties.map((f) => f.id)]} labels={["—", ...faculties.map((f) => f.abbreviation)]} onChange={(v) => setEditing({ ...editing, facultyId: v || null })} />
            )}
            {editing.role === "PRECEPTOR" && (
              <Sel label="Base" value={editing.baseId as string ?? ""} options={["", ...bases.map((b) => b.id)]} labels={["—", ...bases.map((b) => `${b.code} - ${b.name}`)]} onChange={(v) => setEditing({ ...editing, baseId: v || null })} />
            )}
            {!!editing.id && (
              <label className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  checked={!!editing.isActive}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-accent-600"
                />
                <span className="text-sm text-slate-700">Ativo (aprovado)</span>
              </label>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">Salvar</button>
            <button onClick={() => { setEditing(null); setHistory(null); }} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">Cancelar</button>
          </div>
        </div>
      )}

      {/* History section */}
      {!!editing?.id && (editing.role as string) === "INTERN" && (
        <div ref={historyRef} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">
              Histórico — {String(editing.name ?? "")}
              {!!editing.facultyAbbr && (() => {
                const fst = getFacultyStyle(editing.facultyAbbr as string);
                return (
                  <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                    {editing.facultyAbbr as string}
                  </span>
                );
              })()}
            </h2>
            {history && (
              <button onClick={exportPdf} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors">
                <FileDown className="h-3.5 w-3.5" /> Exportar PDF
              </button>
            )}
          </div>

          {historyLoading ? (
            <p className="py-6 text-center text-sm text-slate-400">Carregando histórico...</p>
          ) : history ? (
            <>
              {/* Assignments history */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Plantões ({history.assignments.length})</h3>
                {history.assignments.length === 0 ? (
                  <p className="py-4 text-center text-sm text-slate-400">Nenhum plantão registrado.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="pb-2 pr-3">Data</th>
                          <th className="pb-2 pr-3">Base</th>
                          <th className="pb-2 pr-3">Turno</th>
                          <th className="pb-2 pr-3">Resultado</th>
                          <th className="pb-2 pr-3">Check-in</th>
                          <th className="pb-2">Check-out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.assignments.map((a) => {
                          const outcome = getRowOutcome(a);
                          return (
                            <tr key={a.id} className={`border-b border-slate-50 ${outcome.bg}`}>
                              <td className="py-1.5 pr-3 text-xs">{new Date(a.date + "T12:00:00").toLocaleDateString("pt-BR")}</td>
                              <td className="py-1.5 pr-3 text-xs font-medium">{a.base_code}</td>
                              <td className="py-1.5 pr-3 text-xs">{a.period === "DAY" ? "Diurno" : "Noturno"}</td>
                              <td className="py-1.5 pr-3"><span className="text-xs font-medium">{outcome.label}</span></td>
                              <td className="py-1.5 pr-3 text-xs text-slate-500">{a.checkin_at ? new Date(a.checkin_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                              <td className="py-1.5 text-xs text-slate-500">{a.checkout_at ? new Date(a.checkout_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Requests history */}
              {history.requests.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Solicitações ({history.requests.length})</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                          <th className="pb-2 pr-3">Data</th>
                          <th className="pb-2 pr-3">Tipo</th>
                          <th className="pb-2 pr-3">Base</th>
                          <th className="pb-2 pr-3">Status</th>
                          <th className="pb-2">Observação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.requests.map((r) => (
                          <tr key={r.id} className="border-b border-slate-50">
                            <td className="py-1.5 pr-3 text-xs">{new Date(r.created_at).toLocaleDateString("pt-BR")}</td>
                            <td className="py-1.5 pr-3 text-xs font-medium">{REQ_TYPE_LABEL[r.type] ?? r.type}</td>
                            <td className="py-1.5 pr-3 text-xs">{r.base_code}</td>
                            <td className="py-1.5 pr-3">
                              <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${REQ_STATUS_COLOR[r.status] ?? ""}`}>
                                {REQ_STATUS_LABEL[r.status] ?? r.status}
                              </span>
                            </td>
                            <td className="py-1.5 text-xs text-slate-500">{r.review_notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-emerald-50 border border-emerald-200" /> Presente/Finalizado</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-red-50 border border-red-200" /> Ausente</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-purple-50 border border-purple-200" /> Erro geo</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-violet-50 border border-violet-200" /> TOTP expirado</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-5 rounded bg-fuchsia-50 border border-fuchsia-200" /> Erro QR</span>
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4"></th>
              <th className="pb-2 pr-4">Nome</th>
              <th className="pb-2 pr-4">CPF</th>
              <th className="pb-2 pr-4">Papel</th>
              <th className="pb-2 pr-4">Faculdade</th>
              <th className="pb-2 pr-4">Ativo</th>
              <th className="pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={`border-b border-slate-100 ${!u.isActive ? "bg-amber-50/50" : ""}`}>
                <td className="py-2 pr-2">
                  {u.selfie ? (
                    <img src={u.selfie} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-xs font-medium">
                      {u.name.charAt(0)}
                    </div>
                  )}
                </td>
                <td className="py-2 pr-4">{u.name}</td>
                <td className="py-2 pr-4 font-mono text-xs">{u.cpf}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    u.role === "COORDINATOR" ? "bg-purple-50 text-purple-700" :
                    u.role === "LEADER" ? "bg-emerald-50 text-emerald-700" :
                    u.role === "PRECEPTOR" ? "bg-amber-50 text-amber-700" :
                    "bg-blue-50 text-blue-700"
                  }`}>{ROLE_LABEL[u.role ?? ""] ?? u.role ?? "—"}</span>
                </td>
                <td className="py-2 pr-4">
                  {u.facultyAbbr ? (() => {
                    const fst = getFacultyStyle(u.facultyAbbr);
                    return (
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${fst.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${fst.dot}`} />
                        {u.facultyAbbr}
                      </span>
                    );
                  })() : "—"}
                </td>
                <td className="py-2 pr-4">
                  {u.isActive ? (
                    <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-700">Ativo</span>
                  ) : (
                    <span className="inline-block rounded px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700">Pendente</span>
                  )}
                </td>
                <td className="py-2">
                  <button onClick={() => openEdit(u)} className="text-accent-600 hover:text-accent-500">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="py-8 text-center text-slate-500">Nenhum usuário encontrado.</p>}
      </div>
    </div>
  );
}

function Inp({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
    </label>
  );
}

function Sel({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
        {options.map((o, i) => <option key={o} value={o}>{labels ? labels[i] : o}</option>)}
      </select>
    </label>
  );
}
