"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  GradeDeRemanejamento,
  useRemanejamento,
} from "@/components/intern/remanejamento-interno";
import { participaDoRemanejamento } from "@/lib/remanejamento-interno";

/**
 * Quatro botões no plantão em andamento: a coordenação recebe no WhatsApp, via
 * secretário. Um toque, um aviso — o servidor segura repetição. O aviso já
 * abre a grade de vagas das outras bases: quem avisou está procurando lugar.
 * Base fora do remanejamento (LF90) só tem o aviso. "Base lotada" o servidor
 * só aceita de quem passou do teto, pela ordem de check-in. Base desativada no
 * quadro dos médicos já abre a grade sem aviso.
 *
 * A Dai traz para cá (`luna-ferramentas.ts`, remanejarOpcoes): `?avisar=<id>`
 * rola até os botões; `?remanejar=<id>&destino=<código>` já abre a grade com a
 * base escolhida em destaque. Quem muda de base continua sendo o toque aqui.
 */
const BOTOES = [
  { tipo: "SEM_MEDICO", rotulo: "Sem médico" },
  { tipo: "SEM_ENFERMEIRO", rotulo: "Sem enfermeiro" },
  { tipo: "VIATURA", rotulo: "Problema na viatura" },
  { tipo: "LOTACAO", rotulo: "Base lotada" },
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
  const params = useSearchParams();
  const destino = params.get("remanejar") === assignmentId ? params.get("destino") : null;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const remanejar = params.get("remanejar") === assignmentId;
    if (!remanejar && params.get("avisar") !== assignmentId) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (remanejar && comGrade) void remanejamento.buscar();
    // Só na chegada pelo link: buscar de novo é o botão "Atualizar a grade".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, assignmentId]);

  async function avisar(tipo: string, rotulo: string) {
    if (!window.confirm(`Avisar a coordenação: "${rotulo}"?`)) return;
    setEnviando(tipo);
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/intern/aviso", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-force-role": "INTERN" },
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
    <div ref={ref} className="space-y-3 scroll-mt-24">
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {icon}Avisar a coordenação
        </p>
        <div className="grid grid-cols-2 gap-2">
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
          <GradeDeRemanejamento r={remanejamento} destino={destino} />
        </div>
      )}
    </div>
  );
}
