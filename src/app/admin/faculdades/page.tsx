"use client";

import { useEffect, useState } from "react";

/**
 * Meta da faculdade é uma frase só: tantos USA, tantos CRU, tantos CRL e tantas
 * horas na rotação. Cada número vira uma casinha na tela do interno e na do
 * líder — quem edita aqui está desenhando o que o interno precisa cumprir.
 */
type Faculty = {
  id: string;
  name: string;
  abbreviation: string;
  targetHours: number;
  targetUSAsTotal: number;
  targetCRUsTotal: number;
  targetCRLsTotal: number;
  totalInterns: number;
  rotationStartDate: string;
};

function totalShifts(f: Pick<Faculty, "targetUSAsTotal" | "targetCRUsTotal" | "targetCRLsTotal">) {
  return (f.targetUSAsTotal ?? 0) + (f.targetCRUsTotal ?? 0) + (f.targetCRLsTotal ?? 0);
}

const EMPTY: Partial<Faculty> = {
  name: "",
  abbreviation: "",
  targetHours: 0,
  targetUSAsTotal: 0,
  targetCRUsTotal: 0,
  targetCRLsTotal: 0,
  totalInterns: 0,
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
        <div>
          <h1 className="text-2xl font-bold">Faculdades</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            A meta é o que o interno vê: cada plantão exigido vira uma casinha na tela dele.
          </p>
        </div>
        <button
          onClick={() => setEditing({ ...EMPTY, rotationStartDate: new Date().toISOString().split("T")[0] })}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600"
        >
          + Nova Faculdade
        </button>
      </div>

      {editing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
          <h2 className="font-semibold text-slate-900">{editing.id ? "Editar" : "Nova Faculdade"}</h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input label="Nome" value={editing.name ?? ""} onChange={(v) => setEditing({ ...editing, name: v })} />
            <Input label="Sigla" value={editing.abbreviation ?? ""} onChange={(v) => setEditing({ ...editing, abbreviation: v })} />
            <Input label="Início da contagem" type="date" value={editing.rotationStartDate ?? ""} onChange={(v) => setEditing({ ...editing, rotationStartDate: v })} />
            <Input label="Total de internos" type="number" value={String(editing.totalInterns ?? 0)} onChange={(v) => setEditing({ ...editing, totalInterns: +v })} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Meta da rotação
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Input label="USA" type="number" value={String(editing.targetUSAsTotal ?? 0)} onChange={(v) => setEditing({ ...editing, targetUSAsTotal: +v })} />
              <Input label="CRU" type="number" value={String(editing.targetCRUsTotal ?? 0)} onChange={(v) => setEditing({ ...editing, targetCRUsTotal: +v })} />
              <Input label="CRL" type="number" value={String(editing.targetCRLsTotal ?? 0)} onChange={(v) => setEditing({ ...editing, targetCRLsTotal: +v })} />
              <Input label="Horas" type="number" value={String(editing.targetHours ?? 0)} onChange={(v) => setEditing({ ...editing, targetHours: +v })} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              O interno desta faculdade vai ver{" "}
              <span className="font-semibold text-slate-700">
                {totalShifts({
                  targetUSAsTotal: editing.targetUSAsTotal ?? 0,
                  targetCRUsTotal: editing.targetCRUsTotal ?? 0,
                  targetCRLsTotal: editing.targetCRLsTotal ?? 0,
                })} casinhas
              </span>{" "}
              ({editing.targetUSAsTotal ?? 0} USA · {editing.targetCRUsTotal ?? 0} CRU · {editing.targetCRLsTotal ?? 0} CRL)
              {(editing.targetHours ?? 0) > 0 ? ` e meta de ${editing.targetHours}h.` : "."}
              {" "}Casinha sem plantão escalado fica com alerta para o líder resolver.
            </p>
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
              <th className="pb-2 pr-4">USA</th>
              <th className="pb-2 pr-4">CRU</th>
              <th className="pb-2 pr-4">CRL</th>
              <th className="pb-2 pr-4">Plantões</th>
              <th className="pb-2 pr-4">Horas</th>
              <th className="pb-2 pr-4">Início</th>
              <th className="pb-2 pr-4">Internos</th>
              <th className="pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {faculties.map((f) => (
              <tr key={f.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-mono font-semibold">{f.abbreviation}</td>
                <td className="py-2 pr-4">{f.name}</td>
                <td className="py-2 pr-4 tabular-nums">{f.targetUSAsTotal ?? 0}</td>
                <td className="py-2 pr-4 tabular-nums">{f.targetCRUsTotal ?? 0}</td>
                <td className="py-2 pr-4 tabular-nums">{f.targetCRLsTotal ?? 0}</td>
                <td className="py-2 pr-4 font-semibold tabular-nums">{totalShifts(f)}</td>
                <td className="py-2 pr-4 tabular-nums">{f.targetHours}h</td>
                <td className="py-2 pr-4 font-mono text-xs">{new Date(f.rotationStartDate).toLocaleDateString("pt-BR")}</td>
                <td className="py-2 pr-4 tabular-nums">{f.totalInterns}</td>
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
