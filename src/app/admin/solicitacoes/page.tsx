"use client";

import { useEffect, useState } from "react";

type Request = {
  id: string;
  type: string;
  requesterId: string;
  requesterName: string;
  status: string;
  reviewNotes: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", APPROVED: "Aprovado", REJECTED: "Rejeitado", ESCALATED: "Escalado", COMPLETED: "Concluído" };
const TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };

export default function AdminSolicitacoes() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<{ id: string; status: string; reviewNotes: string } | null>(null);

  async function load() {
    const res = await fetch("/taximetro/api/requests");
    const json = await res.json();
    if (json.success) setRequests(json.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function review(action: string) {
    if (!reviewing) return;
    await fetch("/taximetro/api/requests", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reviewing.id, status: action, reviewNotes: reviewing.reviewNotes }),
    });
    setReviewing(null);
    load();
  }

  if (loading) return <p className="text-slate-400">Carregando...</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Solicitações</h1>

      {reviewing && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
          <h2 className="font-semibold text-slate-900">Analisar Solicitação</h2>
          <div className="flex gap-3 items-end">
            <label className="block flex-1">
              <span className="text-xs text-slate-400">Observação</span>
              <input value={reviewing.reviewNotes} onChange={(e) => setReviewing({ ...reviewing, reviewNotes: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={() => review("APPROVED")} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">Aprovar</button>
            <button onClick={() => review("REJECTED")} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700">Rejeitar</button>
            <button onClick={() => setReviewing(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">Cancelar</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4">Tipo</th>
              <th className="pb-2 pr-4">Solicitante</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Data</th>
              <th className="pb-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{TYPE_LABEL[r.type] ?? r.type}</td>
                <td className="py-2 pr-4">{r.requesterName}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                    r.status === "PENDING" ? "bg-amber-50 text-amber-700" :
                    r.status === "APPROVED" ? "bg-emerald-50 text-emerald-700" :
                    r.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" :
                    r.status === "REJECTED" ? "bg-red-50 text-red-700" :
                    r.status === "ESCALATED" ? "bg-orange-50 text-orange-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                </td>
                <td className="py-2 pr-4 text-xs text-slate-400">{new Date(r.createdAt).toLocaleDateString("pt-BR")}</td>
                <td className="py-2">
                  {r.status === "PENDING" || r.status === "ESCALATED" ? (
                    <button onClick={() => setReviewing({ id: r.id, status: "", reviewNotes: "" })} className="text-accent-600 hover:text-accent-500">Analisar</button>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {requests.length === 0 && <p className="py-8 text-center text-slate-500">Nenhuma solicitação.</p>}
      </div>
    </div>
  );
}
