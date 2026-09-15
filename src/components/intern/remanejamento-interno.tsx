"use client";

import { useState } from "react";

/**
 * Depois do aviso, o interno vê onde há vaga hoje e se move sozinho. A lista
 * traz o médico que está em cada base (quando o canal com o `plantoes` existe)
 * para ele ligar antes de sair.
 */
type Vaga = { id: string; code: string; name: string; vagas: number; medicos: string[] };

export function RemanejamentoInterno({ assignmentId }: { assignmentId: string }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [vagas, setVagas] = useState<Vaga[] | null>(null);
  const [medicosDisponiveis, setMedicosDisponiveis] = useState(false);
  const [indo, setIndo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function buscar() {
    setAberto(true);
    setCarregando(true);
    setMsg(null);
    try {
      const res = await fetch(`/taximetro/api/intern/remanejamento?assignmentId=${assignmentId}`);
      const json = await res.json();
      if (json.success) {
        setVagas(json.data.vagas);
        setMedicosDisponiveis(json.data.medicosDisponiveis);
      } else {
        setVagas(null);
        setMsg({ ok: false, texto: json.error ?? "Não foi possível buscar vagas." });
      }
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão. Tente novamente." });
    }
    setCarregando(false);
  }

  async function ir(vaga: Vaga) {
    const medico = vaga.medicos.length > 0 ? `\nMédico lá agora: ${vaga.medicos.join(", ")}.` : "";
    if (!window.confirm(`Ir para a ${vaga.code} — ${vaga.name}?${medico}\n\nA coordenação será avisada.`)) return;
    setIndo(vaga.id);
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/intern/remanejamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, newBaseId: vaga.id }),
      });
      const json = await res.json();
      if (json.success) {
        window.alert(
          json.data.entregue
            ? `Você agora está na ${json.data.baseCode}. Coordenação avisada.`
            : `Você agora está na ${json.data.baseCode}. O aviso não chegou — ligue para a coordenação.`,
        );
        window.location.reload();
        return;
      }
      setMsg({ ok: false, texto: json.error ?? "Não foi possível remanejar." });
      await buscar();
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão. Tente novamente." });
    }
    setIndo(null);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={buscar}
        disabled={carregando}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
      >
        {carregando ? "Buscando vagas..." : "Ver vaga em outra base"}
      </button>
      {aberto && vagas && vagas.length === 0 && (
        <p className="text-xs text-slate-500">Nenhuma base com vaga neste turno.</p>
      )}
      {aberto && vagas && vagas.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {vagas.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {v.code} <span className="font-normal text-slate-500">— {v.name}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {v.vagas} {v.vagas === 1 ? "vaga" : "vagas"}
                  {medicosDisponiveis && (
                    <> · {v.medicos.length > 0 ? `Dr(a). ${v.medicos.join(", ")}` : "sem médico registrado"}</>
                  )}
                </p>
              </div>
              <button
                type="button"
                disabled={indo !== null}
                onClick={() => ir(v)}
                className="shrink-0 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {indo === v.id ? "Indo..." : "Ir para cá"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.texto}</p>}
    </div>
  );
}
