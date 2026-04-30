"use client";

import { useEffect, useState } from "react";
import { Users, UserCheck, UserMinus } from "lucide-react";

type Cohort = {
  id: string;
  facultyId: string;
  facultyAbbreviation: string | null;
  label: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
  startDate: string;
  endDate: string;
};

type Intern = {
  userRoleId: string;
  userId: string;
  name: string;
  email: string;
  isArchived: boolean;
};

export default function AdminAtribuirTurmas() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [selectedCohortId, setSelectedCohortId] = useState("");
  const [unassigned, setUnassigned] = useState<Intern[]>([]);
  const [assigned, setAssigned] = useState<Intern[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/taximetro/api/admin/cohorts?status=ACTIVE&status=PLANNED")
      .then((r) => r.json())
      .then((j) => { if (j.success) setCohorts(j.data); });
  }, []);

  useEffect(() => {
    if (!selectedCohortId) { setUnassigned([]); setAssigned([]); setSelected(new Set()); return; }
    setLoading(true);
    setError("");
    setMsg("");
    Promise.all([
      fetch(`/taximetro/api/admin/cohorts/${selectedCohortId}/interns?mode=unassigned`).then((r) => r.json()),
      fetch(`/taximetro/api/admin/cohorts/${selectedCohortId}/interns?mode=assigned`).then((r) => r.json()),
    ]).then(([uRes, aRes]) => {
      if (uRes.success) setUnassigned(uRes.data);
      if (aRes.success) setAssigned(aRes.data);
    }).finally(() => setLoading(false));
  }, [selectedCohortId]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === unassigned.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(unassigned.map((i) => i.userRoleId)));
    }
  }

  async function assign() {
    if (!selectedCohortId || selected.size === 0) return;
    setSaving(true);
    setError("");
    setMsg("");
    const res = await fetch(`/taximetro/api/admin/cohorts/${selectedCohortId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userRoleIds: [...selected] }),
    });
    const json = await res.json();
    if (!json.success) { setError(json.error); setSaving(false); return; }
    setMsg(`${json.count} interno(s) atribuído(s) à turma.`);
    setSelected(new Set());
    // Recarregar listas
    const [uRes, aRes] = await Promise.all([
      fetch(`/taximetro/api/admin/cohorts/${selectedCohortId}/interns?mode=unassigned`).then((r) => r.json()),
      fetch(`/taximetro/api/admin/cohorts/${selectedCohortId}/interns?mode=assigned`).then((r) => r.json()),
    ]);
    if (uRes.success) setUnassigned(uRes.data);
    if (aRes.success) setAssigned(aRes.data);
    setSaving(false);
  }

  async function unassign(userRoleId: string) {
    if (!confirm("Remover este interno da turma?")) return;
    const res = await fetch(`/taximetro/api/admin/cohorts/${selectedCohortId}/assign`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userRoleId }),
    });
    const json = await res.json();
    if (!json.success) { alert(json.error); return; }
    setAssigned((prev) => prev.filter((i) => i.userRoleId !== userRoleId));
    const uRes = await fetch(`/taximetro/api/admin/cohorts/${selectedCohortId}/interns?mode=unassigned`).then((r) => r.json());
    if (uRes.success) setUnassigned(uRes.data);
  }

  const selectedCohort = cohorts.find((c) => c.id === selectedCohortId);
  const isClosed = selectedCohort?.status === "CLOSED";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Atribuição de Interns a Turmas</h1>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <label className="block text-sm font-medium text-slate-700">Selecione a turma</label>
        <select
          value={selectedCohortId}
          onChange={(e) => setSelectedCohortId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 sm:w-80"
        >
          <option value="">Selecione uma turma...</option>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.status}] {c.facultyAbbreviation} — {c.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-slate-400 text-sm">Carregando internos...</p>}

      {selectedCohortId && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Coluna: sem turma */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between bg-slate-50 px-4 py-3 border-b border-slate-200">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Users className="h-4 w-4" />
                Sem turma ({unassigned.length})
              </div>
              {unassigned.length > 0 && !isClosed && (
                <button onClick={toggleAll} className="text-xs text-accent-600 hover:text-accent-500">
                  {selected.size === unassigned.length ? "Desmarcar todos" : "Selecionar todos"}
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {unassigned.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-slate-400">
                  Todos os internos desta faculdade já têm turma.
                </p>
              )}
              {unassigned.map((i) => (
                <label key={i.userRoleId} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={isClosed}
                    checked={selected.has(i.userRoleId)}
                    onChange={() => toggleSelect(i.userRoleId)}
                    className="rounded border-slate-300 text-accent-600"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{i.name}</p>
                    <p className="text-xs text-slate-400 truncate">{i.email}</p>
                  </div>
                </label>
              ))}
            </div>
            {selected.size > 0 && !isClosed && (
              <div className="border-t border-slate-200 px-4 py-3">
                <button
                  onClick={assign}
                  disabled={saving}
                  className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <UserCheck className="h-4 w-4" />
                  {saving ? "Atribuindo..." : `Atribuir ${selected.size} interno(s) à turma`}
                </button>
              </div>
            )}
          </div>

          {/* Coluna: já na turma */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 bg-emerald-50 px-4 py-3 border-b border-slate-200 text-sm font-medium text-emerald-700">
              <UserCheck className="h-4 w-4" />
              Na turma ({assigned.length})
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {assigned.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-slate-400">
                  Nenhum interno atribuído a esta turma ainda.
                </p>
              )}
              {assigned.map((i) => (
                <div key={i.userRoleId} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{i.name}</p>
                    <p className="text-xs text-slate-400 truncate">{i.email}</p>
                  </div>
                  {!isClosed && (
                    <button
                      onClick={() => unassign(i.userRoleId)}
                      title="Remover da turma"
                      className="flex-shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <UserMinus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {msg && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
