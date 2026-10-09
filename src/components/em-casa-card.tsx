"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Home } from "lucide-react";
import { getFacultyStyle } from "@/lib/base-colors";

type EmCasa = { id: string; interno: string; faculdade: string; baseCode: string; date: string; period: "DAY" | "NIGHT"; hora: string | null; motivo: string | null };

function dia(date: string) {
  const [, m, d] = date.split("-");
  return `${d}/${m}`;
}

/**
 * Internos mandados para casa pela coordenação que ainda precisam repor.
 * Laranja e casa: nem falta (vermelho) nem falta abonada (violeta).
 */
export function EmCasaCard({ href }: { href: string }) {
  const [itens, setItens] = useState<EmCasa[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch("/taximetro/api/em-casa", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => vivo && j.success && setItens(j.data))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  if (itens.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border-2 border-orange-500 bg-white shadow-sm">
      <div className="flex items-center gap-3 bg-orange-500 px-4 py-3 text-white">
        <Home className="h-6 w-6 shrink-0" strokeWidth={2} />
        <div className="min-w-0">
          <h2 className="text-lg font-bold uppercase tracking-wide">Foram para casa · reposição pendente</h2>
          <p className="text-xs text-orange-50">Base desativada, sem remanejamento. Não é falta e não conta como falta abonada: o plantão precisa ser reposto.</p>
        </div>
      </div>
      <ul className="divide-y divide-orange-100">
        {itens.map((i) => {
          const fs = getFacultyStyle(i.faculdade);
          return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{i.interno}</p>
                <p className="text-xs text-slate-500">
                  {dia(i.date)} · {i.period === "DAY" ? "diurno" : "noturno"} · {i.baseCode}
                  {i.motivo ? ` (${i.motivo})` : ""}
                  {i.hora ? ` · liberado às ${i.hora}` : ""}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${fs.pill}`}>{i.faculdade}</span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-orange-100 bg-orange-50 px-4 py-2 text-right">
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-orange-700 hover:text-orange-800">
          Alocar reposição <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}
