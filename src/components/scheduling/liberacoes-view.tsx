"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Check, ChevronRight, Loader2, RotateCcw } from "lucide-react";

/**
 * Liberações da agenda acadêmica: quem perdeu plantão por prova/atividade da
 * turma, por faculdade. Um toque decide — abonar (conta na meta) ou repor
 * (prioridade no sorteio da repescagem e aviso diário da Dai). Sem modal:
 * dá para trocar de ideia com outro toque. Ver commitment-releases.ts.
 */

type Escopo = "admin" | "leader";
type Resolucao = "PENDENTE" | "ABONADO" | "REPOR";
type Item = {
  id: string; internName: string; facultyId: string; facultyAbbr: string;
  date: string; period: "DAY" | "NIGHT"; baseCode: string; baseType: string;
  resolution: Resolucao; title: string; kind: string;
  faltam: Record<string, number> | null; deve: boolean;
};
type Resumo = { pendentes: number; repor: number; repostos: number; abonados: number };

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const TIPO_DA_BASE: Record<string, string> = { USA: "USA", CENTRAL: "CRU", CRL: "CRL" };

function api(escopo: Escopo) {
  return escopo === "admin" ? "/taximetro/api/admin/liberacoes" : "/taximetro/api/leader/liberacoes";
}
function headers(escopo: Escopo, extra?: Record<string, string>) {
  return escopo === "admin" ? { ...extra, "x-no-impersonate": "1" } : { ...extra };
}
function quando(i: Item) {
  return `${DIAS[new Date(`${i.date}T12:00:00Z`).getUTCDay()]} ${i.date.slice(8, 10)}/${i.date.slice(5, 7)} ${i.period === "DAY" ? "diurno" : "noturno"}`;
}

function situacao(i: Item): { texto: string; classe: string } {
  if (i.resolution === "ABONADO") return { texto: "Abonado", classe: "bg-emerald-100 text-emerald-800" };
  if (i.resolution === "REPOR") {
    const tipo = TIPO_DA_BASE[i.baseType];
    const n = tipo ? i.faltam?.[tipo] ?? 0 : 0;
    return i.deve
      ? { texto: `Repor · faltam ${n} ${tipo}`, classe: "bg-rose-600 text-white" }
      : { texto: "Reposto", classe: "bg-slate-200 text-slate-700" };
  }
  return { texto: "Decidir", classe: "bg-amber-100 text-amber-800" };
}

async function carregarLiberacoes(escopo: Escopo) {
  const res = await fetch(api(escopo), { cache: "no-store", headers: headers(escopo) });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "Erro ao carregar");
  return json.data as { itens: Item[]; resumo: Resumo };
}

export function LiberacoesView({ escopo }: { escopo: Escopo }) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  async function carregar() {
    try {
      const d = await carregarLiberacoes(escopo);
      setItens(d.itens);
      setResumo(d.resumo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao carregar");
    }
  }
  useEffect(() => { void carregar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [escopo]);

  async function decidir(i: Item, resolution: "ABONADO" | "REPOR") {
    if (i.resolution === resolution) return;
    setSalvando(i.id);
    setErro("");
    try {
      const res = await fetch(api(escopo), {
        method: "PATCH",
        headers: headers(escopo, { "Content-Type": "application/json" }),
        body: JSON.stringify({ id: i.id, resolution }),
      });
      const json = await res.json();
      if (!json.success) setErro(json.error ?? "Não deu para salvar");
      await carregar();
    } catch {
      setErro("Não deu para salvar. Tente de novo.");
    } finally {
      setSalvando(null);
    }
  }

  const porFaculdade = new Map<string, Item[]>();
  for (const i of itens ?? []) porFaculdade.set(i.facultyAbbr, [...(porFaculdade.get(i.facultyAbbr) ?? []), i]);
  const ordem: Record<Resolucao, number> = { PENDENTE: 0, REPOR: 1, ABONADO: 2 };

  return (
    <div className="space-y-6 animate-[fadeInUp_200ms_ease-out]">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <CalendarClock className="h-6 w-6 text-rose-600" /> Liberações
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Internos que saíram da escala por prova ou atividade fixa da turma (Agenda da turma, na Montar Escala).
          Abonar conta o plantão na meta. Repor deixa o interno devendo: ele entra na frente nos sorteios da repescagem e a Dai avisa todo dia até fechar a meta.
        </p>
      </div>

      {resumo && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            ["Para decidir", resumo.pendentes, "text-amber-700"],
            ["Devendo reposição", resumo.repor, "text-rose-700"],
            ["Já repostos", resumo.repostos, "text-slate-700"],
            ["Abonados", resumo.abonados, "text-emerald-700"],
          ] as const).map(([rotulo, n, cor]) => (
            <div key={rotulo} className="rounded-xl border border-rose-100 bg-white px-4 py-3">
              <p className="text-xs font-medium text-slate-500">{rotulo}</p>
              <p className={`text-2xl font-bold tabular-nums ${cor}`}>{n}</p>
            </div>
          ))}
        </div>
      )}

      {erro && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      {itens === null && !erro ? (
        <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>
      ) : itens && itens.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/50 p-8 text-center text-sm text-rose-800">
          Ninguém saiu da escala por compromisso da turma nos últimos 60 dias.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...porFaculdade.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([faculdade, lista]) => {
            const pendentes = lista.filter((i) => i.resolution === "PENDENTE").length;
            return (
              <section key={faculdade} className="overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <header className="flex items-center justify-between bg-gradient-to-r from-rose-500 to-pink-600 px-4 py-3 text-white">
                  <h2 className="text-base font-bold">{faculdade}</h2>
                  <span className="text-xs text-rose-50">
                    {lista.length} liberação(ões){pendentes ? ` · ${pendentes} para decidir` : ""}
                  </span>
                </header>
                <ul className="divide-y divide-rose-100">
                  {[...lista].sort((a, b) => ordem[a.resolution] - ordem[b.resolution] || b.date.localeCompare(a.date)).map((i) => {
                    const s = situacao(i);
                    const ocupado = salvando === i.id;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900">{i.internName}</p>
                          <p className="text-xs text-slate-600">{quando(i)} · {i.baseCode} · {i.title}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${s.classe}`}>{s.texto}</span>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => decidir(i, "ABONADO")}
                            aria-pressed={i.resolution === "ABONADO"}
                            className={`inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 text-xs font-bold transition disabled:opacity-50 ${i.resolution === "ABONADO" ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"}`}
                          >
                            {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Abonar
                          </button>
                          <button
                            type="button"
                            disabled={ocupado}
                            onClick={() => decidir(i, "REPOR")}
                            aria-pressed={i.resolution === "REPOR"}
                            className={`inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 text-xs font-bold transition disabled:opacity-50 ${i.resolution === "REPOR" ? "border-rose-600 bg-rose-600 text-white" : "border-rose-300 text-rose-800 hover:bg-rose-50"}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Repor
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** KPI do cockpit: mesmo padrão rosa, leva à aba. */
export function LiberacoesKpi({ escopo }: { escopo: Escopo }) {
  const [resumo, setResumo] = useState<Resumo | null>(null);
  useEffect(() => {
    carregarLiberacoes(escopo).then((d) => setResumo(d.resumo)).catch(() => setResumo(null));
  }, [escopo]);
  if (!resumo) return null;

  return (
    <Link
      href={escopo === "admin" ? "/admin/liberacoes" : "/leader/liberacoes"}
      className="group flex items-center gap-4 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-500 to-pink-600 p-4 text-white shadow-[0_8px_24px_rgba(225,29,72,0.18)] transition hover:-translate-y-px hover:shadow-[0_10px_28px_rgba(225,29,72,0.26)]"
    >
      <CalendarClock className="h-8 w-8 shrink-0 text-rose-100" strokeWidth={1.6} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-rose-100">Liberações · agenda da turma</p>
        <p className="mt-0.5 text-sm">
          <span className="text-2xl font-bold tabular-nums">{resumo.pendentes}</span> para decidir
          <span className="mx-2 text-rose-200">·</span>
          <span className="font-semibold tabular-nums">{resumo.repor}</span> devendo reposição
          <span className="mx-2 text-rose-200">·</span>
          <span className="font-semibold tabular-nums">{resumo.abonados}</span> abonados
        </p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-rose-100 transition group-hover:translate-x-0.5" />
    </Link>
  );
}
