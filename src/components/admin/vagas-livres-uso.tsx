"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Quem usou vaga livre nos últimos 30 dias, por líder. Serve para a coordenação
 * balancear e perceber abuso: um líder concentrando vagas das outras
 * faculdades aparece no topo. Dados: listFreeSlotUsage (auto-release-slots.ts).
 */

export type UsoVagaLivre = {
  leaderId: string | null;
  leaderName: string;
  facultyAbbr: string;
  baseCode: string;
  date: string;
  period: string;
  origem: string;
  claimedAt: string | null;
};

function br(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function VagasLivresUso({ rows }: { rows: UsoVagaLivre[] }) {
  const [aberto, setAberto] = useState<string | null>(null);

  const porLider = new Map<string, { nome: string; faculdade: string; usos: UsoVagaLivre[] }>();
  for (const r of rows) {
    const k = r.leaderId ?? r.leaderName;
    if (!porLider.has(k)) porLider.set(k, { nome: r.leaderName, faculdade: r.facultyAbbr, usos: [] });
    porLider.get(k)!.usos.push(r);
  }
  const lideres = [...porLider.entries()].sort((a, b) => b[1].usos.length - a[1].usos.length);
  const maior = lideres[0]?.[1].usos.length ?? 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Vagas livres usadas por líder (30 dias)</h2>
        <span className="text-xs text-slate-500">{rows.length} vaga{rows.length === 1 ? "" : "s"} · {lideres.length} líder{lideres.length === 1 ? "" : "es"}</span>
      </div>
      {lideres.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Nenhuma vaga livre usada no período.</p>
      ) : (
        <div className="space-y-2">
          {lideres.map(([k, l]) => {
            const origens = new Map<string, number>();
            for (const u of l.usos) origens.set(u.origem, (origens.get(u.origem) ?? 0) + 1);
            const expandido = aberto === k;
            return (
              <div key={k}>
                <button
                  type="button"
                  onClick={() => setAberto(expandido ? null : k)}
                  className="w-full text-left"
                  aria-expanded={expandido}
                >
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-1 font-medium text-slate-700">
                      {expandido ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{l.nome}</span>
                      <span className="shrink-0 text-xs font-normal text-slate-500">{l.faculdade}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                      <span className="hidden sm:inline">{[...origens].map(([o, n]) => `${o} ${n}`).join(" · ")}</span>
                      <span className="font-semibold tabular-nums text-slate-900">{l.usos.length}</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-teal-500" style={{ width: `${maior ? (l.usos.length / maior) * 100 : 0}%` }} />
                  </div>
                </button>
                {expandido && (
                  <ul className="mt-2 space-y-1 border-l-2 border-slate-100 pl-4 text-xs text-slate-600">
                    {l.usos.map((u, i) => (
                      <li key={i}>
                        {u.baseCode} · {br(u.date)} {u.period === "DAY" ? "diurno" : "noturno"} · vaga {u.origem}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
