"use client";

import { useState, type ReactNode } from "react";

/**
 * Três botões no plantão em andamento: a coordenação recebe no WhatsApp, via
 * secretário. Um toque, um aviso — o servidor segura repetição.
 */
const BOTOES = [
  { tipo: "SEM_MEDICO", rotulo: "Sem médico" },
  { tipo: "SEM_ENFERMEIRO", rotulo: "Sem enfermeiro" },
  { tipo: "VIATURA", rotulo: "Problema na viatura" },
] as const;

export function AvisoCoordenacao({ assignmentId, icon }: { assignmentId: string; icon?: ReactNode }) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function avisar(tipo: string, rotulo: string) {
    if (!window.confirm(`Avisar a coordenação: "${rotulo}"?`)) return;
    setEnviando(tipo);
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/intern/aviso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, tipo }),
      });
      const json = await res.json();
      if (json.success && json.data?.entregue) setMsg({ ok: true, texto: "Coordenação avisada." });
      else if (json.success) setMsg({ ok: false, texto: "Aviso registrado, mas a entrega falhou. Ligue para a coordenação." });
      else setMsg({ ok: false, texto: json.error ?? "Não foi possível avisar." });
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão. Tente novamente." });
    }
    setEnviando(null);
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">{icon}Avisar a coordenação</p>
      <div className="grid grid-cols-3 gap-2">
        {BOTOES.map((b) => (
          <button
            key={b.tipo}
            type="button"
            disabled={enviando !== null}
            onClick={() => avisar(b.tipo, b.rotulo)}
            className="rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {enviando === b.tipo ? "Enviando..." : b.rotulo}
          </button>
        ))}
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.texto}</p>}
    </div>
  );
}
