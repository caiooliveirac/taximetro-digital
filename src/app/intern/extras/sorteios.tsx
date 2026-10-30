"use client";

import { useCallback, useEffect, useState } from "react";
import { Dices, Loader2, Users } from "lucide-react";

/* Sorteio da repescagem (sorteio-repescagem.ts): inscrição, inscritos públicos e resultado. */

type Proximo = {
  date: string;
  period: "DAY" | "NIGHT";
  turno: string;
  hora: string;
  sorteando: boolean;
  vagas: { tipo: string; n: number }[];
  inscritos: { nome: string; faculdade: string | null; eu: boolean }[];
  inscrito: boolean;
};
type Resultado = {
  turno: string;
  semente: string;
  linhas: { posicao: number; nome: string; faculdade: string | null; prioridade: string | null; levou: string | null; eu: boolean }[];
};

const nomeCurto = (nome: string) => nome.split(/\s+/).slice(0, 2).join(" ");

export function Sorteios() {
  const [dados, setDados] = useState<{ proximos: Proximo[]; resultados: Resultado[] } | null>(null);
  const [mexendo, setMexendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/taximetro/api/intern/sorteios").then((x) => x.json()).catch(() => null);
    if (r?.success) setDados(r.data);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternar(p: Proximo) {
    const k = `${p.date}|${p.period}`;
    setMexendo(k);
    setErro(null);
    try {
      const r = await fetch("/taximetro/api/intern/sorteios", {
        method: p.inscrito ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: p.date, period: p.period }),
      }).then((x) => x.json());
      if (!r.success) setErro(r.error ?? "Não deu certo agora.");
      await carregar();
    } finally {
      setMexendo(null);
    }
  }

  if (!dados || (!dados.proximos.length && !dados.resultados.length)) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Dices className="h-4 w-4 text-sky-600" />
        <h2 className="text-sm font-bold text-slate-900">Sorteios da repescagem</h2>
      </div>
      <p className="text-xs text-slate-500">
        Vaga livre que ninguém escalar até a repescagem vai a sorteio na hora em que ela abre. Primeiro quem tem casinha vazia no tipo, depois quem nunca teve extra, por último quem já teve; no empate, a ordem sorteada.
      </p>
      {erro ? <p className="text-xs font-medium text-red-600">{erro}</p> : null}

      {dados.proximos.map((p) => {
        const k = `${p.date}|${p.period}`;
        return (
          <div key={k} className="space-y-2 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">{p.turno}</p>
                <p className="text-xs text-slate-600">
                  {p.sorteando ? "Sorteando agora…" : <>Sorteio <strong>{p.hora}</strong></>} ·{" "}
                  {p.vagas.length ? p.vagas.map((v) => `${v.n} ${v.tipo}`).join(", ") + " em jogo agora" : "nenhuma vaga livre agora (o líder ainda pode escalar ou liberar)"}
                </p>
              </div>
              {!p.sorteando && (
                <button
                  type="button"
                  disabled={mexendo === k}
                  onClick={() => void alternar(p)}
                  className={`shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold active:scale-95 disabled:opacity-50 ${p.inscrito ? "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" : "bg-sky-600 text-white hover:bg-sky-700"}`}
                >
                  {mexendo === k ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {p.inscrito ? "Sair" : "Me inscrever"}
                </button>
              )}
            </div>
            <details className="text-xs text-slate-600">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold text-slate-500">
                <Users className="h-3.5 w-3.5" /> {p.inscritos.length} {p.inscritos.length === 1 ? "inscrito" : "inscritos"}
              </summary>
              {p.inscritos.length ? (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {p.inscritos.map((i, n) => (
                    <li key={n} className={`rounded-full border px-2 py-0.5 ${i.eu ? "border-sky-300 bg-sky-50 font-semibold text-sky-800" : "border-slate-200 bg-slate-50"}`}>
                      {nomeCurto(i.nome)}{i.faculdade ? ` · ${i.faculdade}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          </div>
        );
      })}

      {dados.resultados.map((r) => (
        <details key={r.turno} className="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
          <summary className="cursor-pointer list-none font-semibold text-slate-700">
            Resultado · {r.turno} · {r.linhas.filter((l) => l.levou).length} de {r.linhas.length} levaram
          </summary>
          <ol className="mt-2 space-y-1">
            {r.linhas.map((l) => (
              <li key={l.posicao} className={l.eu ? "font-semibold text-sky-800" : ""}>
                {l.posicao}º {nomeCurto(l.nome)}{l.faculdade ? ` · ${l.faculdade}` : ""}
                {l.prioridade ? <span className="text-slate-400"> ({l.prioridade})</span> : null}
                {l.levou ? <span className="text-emerald-700"> → {l.levou}</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 break-all text-[10px] text-slate-400">Semente: {r.semente} — a ordem é sha256(semente:id) de cada inscrito, do menor para o maior.</p>
        </details>
      ))}
    </section>
  );
}
