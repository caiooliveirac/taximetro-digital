"use client";

import { useEffect, useState } from "react";

type Faculty = {
  id: string;
  name: string;
  abbreviation: string;
  targetHours: number;
  targetShifts: number;
  targetShiftsPerWeek: number;
  targetUSAsPerWeek: number;
  targetCRUsPerWeek: number;
  targetCRLsPerWeek: number;
  totalInterns: number;
};

export default function AdminFaculdades() {
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [editing, setEditing] = useState<Partial<Faculty> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/taximetro/api/admin/faculties");
      const json = await res.json();
      if (json.success) setFaculties(json.data);
    } catch {
      setError("Erro ao carregar faculdades.");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setError("");
    if (!editing) return;
    try {
      const isNew = !editing.id;
      const res = await fetch("/taximetro/api/admin/faculties", {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const json = await res.json();
      if (!json.success) { setError(json.error); return; }
      setEditing(null);
      load();
    } catch {
      setError("Erro de conexão. Tente novamente.");
    }
  }

  if (loading) return <p className="text-slate-400">Carregando...</p>;
  if (!faculties.length && error) return <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Faculdades</h1>
        <button onClick={() => setEditing({ name: "", abbreviation: "", targetHours: 0, targetShifts: 0, targetShiftsPerWeek: 0, targetUSAsPerWeek: 0, targetCRUsPerWeek: 0, targetCRLsPerWeek: 0, totalInterns: 0 })} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600">
          + Nova Faculdade
        </button>
      </div>

      {editing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <h2 className="font-semibold text-slate-900">{editing.id ? "Editar" : "Nova Faculdade"}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Input label="Nome" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
            <Input label="Sigla" value={editing.abbreviation ?? ""} onChange={(v) => setEditing({ ...editing, abbreviation: v })} />
            <Input label="Meta Horas (total)" type="number" value={String(editing.targetHours ?? 0)} onChange={(v) => setEditing({ ...editing, targetHours: +v })} />
            <Input label="Meta Plantões (total)" type="number" value={String(editing.targetShifts ?? 0)} onChange={(v) => setEditing({ ...editing, targetShifts: +v })} />
            <Input label="Meta Plantões/Semana (deprecated)" type="number" value={String(editing.targetShiftsPerWeek ?? 0)} onChange={(v) => setEditing({ ...editing, targetShiftsPerWeek: +v })} />
            <Input label="Meta USAs/Semana" type="number" value={String(editing.targetUSAsPerWeek ?? 0)} onChange={(v) => setEditing({ ...editing, targetUSAsPerWeek: +v })} />
            <Input label="Meta CRUs/Semana" type="number" value={String(editing.targetCRUsPerWeek ?? 0)} onChange={(v) => setEditing({ ...editing, targetCRUsPerWeek: +v })} />
            <Input label="Meta CRLs/Semana" type="number" value={String(editing.targetCRLsPerWeek ?? 0)} onChange={(v) => setEditing({ ...editing, targetCRLsPerWeek: +v })} />
            <Input label="Total Internos" type="number" value={String(editing.totalInterns ?? 0)} onChange={(v) => setEditing({ ...editing, totalInterns: +v })} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">Salvar</button>
            <button onClick={() => setEditing(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">Cancelar</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4">Sigla</th>
              <th className="pb-2 pr-4">Nome</th>
              <th className="pb-2 pr-4">Meta Horas</th>
              <th className="pb-2 pr-4">Meta Plantões</th>
              <th className="pb-2 pr-4">USA/sem</th>
              <th className="pb-2 pr-4">CRU/sem</th>
              <th className="pb-2 pr-4">CRL/sem</th>
              <th className="pb-2 pr-4">Internos</th>
              <th className="pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {faculties.map((f) => (
              <tr key={f.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-mono font-semibold">{f.abbreviation}</td>
                <td className="py-2 pr-4">{f.name}</td>
                <td className="py-2 pr-4">{f.targetHours}h</td>
                <td className="py-2 pr-4">{f.targetShifts}</td>
                <td className="py-2 pr-4">{f.targetUSAsPerWeek ?? 0}</td>
                <td className="py-2 pr-4">{f.targetCRUsPerWeek ?? 0}</td>
                <td className="py-2 pr-4">{f.targetCRLsPerWeek ?? 0}</td>
                <td className="py-2 pr-4">{f.totalInterns}</td>
                <td className="py-2">
                  <button onClick={() => setEditing(f)} className="text-accent-600 hover:text-accent-500">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-slate-400">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
    </label>
  );
}
