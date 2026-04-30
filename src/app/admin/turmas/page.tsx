"use client";

import { useEffect, useState } from "react";

type Cohort = {
  id: string;
  facultyId: string;
  facultyName: string | null;
  facultyAbbreviation: string | null;
  rotationNumber: number;
  startDate: string;
  endDate: string;
  name: string | null;
  label: string;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
};

type Faculty = { id: string; name: string; abbreviation: string };

const STATUS_LABEL: Record<Cohort["status"], string> = {
  PLANNED: "Planejada",
  ACTIVE: "Ativa",
  CLOSED: "Fechada",
};

const STATUS_COLOR: Record<Cohort["status"], string> = {
  PLANNED: "bg-slate-100 text-slate-600",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CLOSED: "bg-red-50 text-red-700",
};

export default function AdminTurmas() {
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [editing, setEditing] = useState<Partial<Cohort> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterFaculty, setFilterFaculty] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterFaculty) params.set("facultyId", filterFaculty);
      if (filterStatus) params.set("status", filterStatus);
      const [cohortRes, facultyRes] = await Promise.all([
        fetch(`/taximetro/api/admin/cohorts?${params}`),
        fetch("/taximetro/api/admin/faculties"),
      ]);
      const cohortJson = await cohortRes.json();
      const facultyJson = await facultyRes.json();
      if (cohortJson.success) setCohorts(cohortJson.data);
      if (facultyJson.success) setFaculties(facultyJson.data);
    } catch {
      setError("Erro ao carregar dados.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [filterFaculty, filterStatus]);

  function openNew() {
    setIsNew(true);
    setEditing({
      facultyId: "",
      rotationNumber: 1,
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date().toISOString().split("T")[0],
      name: "",
      label: "",
      status: "PLANNED",
    });
    setError("");
  }

  function openEdit(c: Cohort) {
    setIsNew(false);
    setEditing({ ...c });
    setError("");
  }

  async function save() {
    if (!editing) return;
    setError("");
    try {
      const res = await fetch(
        isNew ? "/taximetro/api/admin/cohorts" : `/taximetro/api/admin/cohorts/${editing.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing),
        }
      );
      const json = await res.json();
      if (!json.success) { setError(json.error); return; }
      setEditing(null);
      load();
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
  }

  async function remove(id: string) {
    if (!confirm("Excluir esta turma? Só turmas PLANNED podem ser excluídas.")) return;
    const res = await fetch(`/taximetro/api/admin/cohorts/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.success) { alert(json.error); return; }
    load();
  }

  if (loading) return <p className="text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Turmas</h1>
        <div className="flex gap-2">
          <a href="/taximetro/admin/turmas/atribuir" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Atribuir interns
          </a>
          <button onClick={openNew} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600">
            + Nova Turma
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <select
          value={filterFaculty}
          onChange={(e) => setFilterFaculty(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">Todas as faculdades</option>
          {faculties.map((f) => (
            <option key={f.id} value={f.id}>{f.abbreviation} — {f.name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
        >
          <option value="">Todos os status</option>
          <option value="PLANNED">Planejada</option>
          <option value="ACTIVE">Ativa</option>
          <option value="CLOSED">Fechada</option>
        </select>
      </div>

      {editing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <h2 className="font-semibold text-slate-900">{isNew ? "Nova Turma" : "Editar Turma"}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs text-slate-400">Faculdade</span>
              <select
                value={editing.facultyId ?? ""}
                onChange={(e) => setEditing({ ...editing, facultyId: e.target.value })}
                disabled={!isNew}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
              >
                <option value="">Selecione...</option>
                {faculties.map((f) => (
                  <option key={f.id} value={f.id}>{f.abbreviation} — {f.name}</option>
                ))}
              </select>
            </label>
            <Input label="Nº do Rodízio" type="number" value={String(editing.rotationNumber ?? 1)} onChange={(v) => setEditing({ ...editing, rotationNumber: +v })} disabled={!isNew} />
            <Input label="Nome da Turma" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
            <Input label="Label" value={editing.label ?? ""} onChange={(v) => setEditing({ ...editing, label: v })} />
            <Input label="Início" type="date" value={editing.startDate ?? ""} onChange={(v) => setEditing({ ...editing, startDate: v })} />
            <Input label="Fim" type="date" value={editing.endDate ?? ""} onChange={(v) => setEditing({ ...editing, endDate: v })} />
            {!isNew && (
              <label className="block">
                <span className="text-xs text-slate-400">Status</span>
                <select
                  value={editing.status ?? "PLANNED"}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value as Cohort["status"] })}
                  className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="PLANNED">Planejada</option>
                  <option value="ACTIVE">Ativa</option>
                </select>
              </label>
            )}
            <label className="col-span-2 block sm:col-span-3">
              <span className="text-xs text-slate-400">Observações</span>
              <textarea
                value={editing.notes ?? ""}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                rows={2}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">Salvar</button>
            <button onClick={() => setEditing(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">Cancelar</button>
          </div>
        </div>
      )}

      {error && !editing && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4">Faculdade</th>
              <th className="pb-2 pr-4">Rodízio</th>
              <th className="pb-2 pr-4">Nome</th>
              <th className="pb-2 pr-4">Label</th>
              <th className="pb-2 pr-4">Início</th>
              <th className="pb-2 pr-4">Fim</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-slate-400">Nenhuma turma encontrada.</td></tr>
            )}
            {cohorts.map((c) => (
              <tr key={c.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-mono font-semibold">{c.facultyAbbreviation ?? "—"}</td>
                <td className="py-2 pr-4">{c.rotationNumber}</td>
                <td className="py-2 pr-4 font-medium">{c.name ?? <span className="text-slate-400 italic">—</span>}</td>
                <td className="py-2 pr-4">{c.label}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtDate(c.startDate)}</td>
                <td className="py-2 pr-4 font-mono text-xs">{fmtDate(c.endDate)}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                </td>
                <td className="py-2 flex gap-3">
                  {c.status !== "CLOSED" && (
                    <button onClick={() => openEdit(c)} className="text-accent-600 hover:text-accent-500">Editar</button>
                  )}
                  {c.status === "PLANNED" && (
                    <button onClick={() => remove(c.id)} className="text-red-500 hover:text-red-700">Excluir</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("pt-BR");
}

function Input({
  label, value, onChange, type = "text", disabled,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50"
      />
    </label>
  );
}
