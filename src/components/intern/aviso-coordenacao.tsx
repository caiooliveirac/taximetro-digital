"use client";

import { useState, type ReactNode } from "react";
import {
  GradeDeRemanejamento,
  useRemanejamento,
} from "@/components/intern/remanejamento-interno";
import { participaDoRemanejamento } from "@/lib/remanejamento-interno";

/**
 * Três botões no plantão em andamento: a coordenação recebe no WhatsApp, via
 * secretário. Um toque, um aviso — o servidor segura repetição. O aviso já
 * abre a grade de vagas das outras bases: quem avisou está procurando lugar.
 * Base fora do remanejamento (LF90) só tem o aviso.
 */
const BOTOES = [
  { tipo: "SEM_MEDICO", rotulo: "Sem médico" },
  { tipo: "SEM_ENFERMEIRO", rotulo: "Sem enfermeiro" },
  { tipo: "VIATURA", rotulo: "Problema na viatura" },
] as const;

export function AvisoCoordenacao({
  assignmentId,
  baseCode,
  icon,
}: {
  assignmentId: string;
  baseCode: string;
  icon?: ReactNode;
}) {
  const comGrade = participaDoRemanejamento(baseCode);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const remanejamento = useRemanejamento(assignmentId);

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
      if (json.success && json.data?.entregue)
        setMsg({ ok: true, texto: "Coordenação avisada." });
      else if (json.success)
        setMsg({
          ok: false,
          texto:
            "Aviso registrado, mas a entrega falhou. Ligue para a coordenação.",
        });
      else
        setMsg({ ok: false, texto: json.error ?? "Não foi possível avisar." });
      if (json.success && comGrade) await remanejamento.buscar();
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão. Tente novamente." });
    }
    setEnviando(null);
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {icon}Avisar a coordenação
        </p>
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
        {msg && (
          <p
            className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}
          >
            {msg.texto}
          </p>
        )}
      </div>

      {comGrade && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={remanejamento.buscar}
            disabled={remanejamento.carregando}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            {remanejamento.carregando
              ? "Carregando a grade..."
              : remanejamento.grade
                ? "Atualizar a grade"
                : "Ver vaga em outra base"}
          </button>
          <GradeDeRemanejamento r={remanejamento} />
        </div>
      )}
    </div>
  );
}
