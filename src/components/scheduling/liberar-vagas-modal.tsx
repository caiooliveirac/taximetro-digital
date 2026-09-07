"use client";

import { useEffect, useState } from "react";
import { Loader2, Unlock, X } from "lucide-react";
import { localDateStr } from "@/lib/utils";
import {
  baseDaEscala,
  cabecalhosDaEscala,
  corpoComFaculdade,
  escopoDeEscala,
  urlComFaculdade,
} from "@/features/scheduling/domain/policies/escala-scope";

/**
 * "Liberar vagas": a faculdade avisa que numa data/turno não vai usar as vagas
 * da grade fixa. Dois passos — o que liberar (só intervenção, ou regulação
 * também) e quando (data + turnos). O mesmo modal abre do cockpit do líder e da
 * tela de escala (líder e coordenador). Ver release-slots.ts.
 */

type Released = { id: string; baseCode: string; period: string; claimedBy: string | null };
type Previa = { period: Periodo; open: number; interns: { assignmentId: string; internName: string; baseCode: string }[] };
type Escopo = "USA" | "ALL";
type Periodo = "DAY" | "NIGHT";

export function LiberarVagasButton({ facultyId, pickFaculty, onChanged, className }: {
  facultyId?: string | null;
  /** Coordenador fora da tela de escala: escolhe a faculdade dentro do modal. */
  pickFaculty?: boolean;
  onChanged?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "inline-flex min-h-11 items-center gap-2 rounded-2xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-800 transition hover:bg-violet-100"}
      >
        <Unlock className="h-4 w-4" /> Liberar vagas
      </button>
      {open && <LiberarVagasModal facultyId={facultyId} pickFaculty={pickFaculty} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

type Faculdade = { id: string; abbreviation: string; name: string; isVirtual?: boolean };

export function LiberarVagasModal({ facultyId, pickFaculty, onClose, onChanged }: {
  facultyId?: string | null;
  pickFaculty?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [faculdades, setFaculdades] = useState<Faculdade[]>([]);
  const [faculdadeEscolhida, setFaculdadeEscolhida] = useState("");
  const faculdadeAtiva = facultyId ?? (pickFaculty ? faculdadeEscolhida || null : null);
  const escopo = escopoDeEscala(faculdadeAtiva);
  const api = `${baseDaEscala(escopo)}/released-slots`;

  useEffect(() => {
    if (!pickFaculty) return;
    fetch("/taximetro/api/admin/faculties", { cache: "no-store", headers: { "x-no-impersonate": "1" } })
      .then((r) => r.json())
      .then((json) => { if (json.success) setFaculdades((json.data as Faculdade[]).filter((f) => !f.isVirtual)); })
      .catch(() => {});
  }, [pickFaculty]);

  const [scope, setScope] = useState<Escopo | null>(null);
  const [date, setDate] = useState("");
  const [periods, setPeriods] = useState<Set<Periodo>>(new Set(["DAY"]));
  const [released, setReleased] = useState<Released[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [previa, setPrevia] = useState<Previa[] | null>(null);
  const today = localDateStr();

  async function carregar(dia: string) {
    const res = await fetch(urlComFaculdade(`${api}?from=${dia}&to=${dia}`, escopo), {
      cache: "no-store",
      headers: cabecalhosDaEscala(escopo),
    });
    const json = await res.json();
    setReleased(json.success ? json.data : []);
  }

  const prontoParaEscolher = !pickFaculty || Boolean(faculdadeAtiva);
  useEffect(() => { if (date && prontoParaEscolher) void carregar(date); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [date, faculdadeAtiva]);

  function togglePeriodo(p: Periodo) {
    setPeriods((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  }

  async function postLiberar(period: Periodo, preview: boolean) {
    const res = await fetch(api, {
      method: "POST",
      headers: cabecalhosDaEscala(escopo, { "Content-Type": "application/json" }),
      body: JSON.stringify(corpoComFaculdade({ date, period, scope, preview }, escopo)),
    });
    return res.json();
  }

  /** Primeiro passo do botão: só mostra o que vai acontecer. */
  async function prever() {
    if (!scope || !date || periods.size === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const lista: Previa[] = [];
      for (const period of periods) {
        const json = await postLiberar(period, true);
        if (!json.success) { setMsg(`❌ ${json.error}`); setBusy(false); return; }
        lista.push({ period, open: json.data.open, interns: json.data.interns });
      }
      setPrevia(lista);
    } catch {
      setMsg("❌ Erro ao calcular a liberação.");
    }
    setBusy(false);
  }

  async function liberar() {
    if (!previa) return;
    setBusy(true);
    setMsg("");
    let total = 0;
    let removidos = 0;
    try {
      for (const { period } of previa) {
        const json = await postLiberar(period, false);
        if (!json.success) { setMsg(`❌ ${json.error}`); setBusy(false); return; }
        total += json.data.created;
        removidos += json.data.interns.length;
      }
      setPrevia(null);
      setMsg(total === 0
        ? "Nenhuma vaga aberta para liberar — já estão liberadas."
        : `✅ ${total} vaga(s) liberada(s)${removidos > 0 ? `, ${removidos} interno(s) fora da escala` : ""}. Saem do sorteio e ficam livres para as outras faculdades.`);
      await carregar(date);
      onChanged?.();
    } catch {
      setMsg("❌ Erro ao liberar vagas.");
    }
    setBusy(false);
  }

  async function desfazer(period: Periodo) {
    setBusy(true);
    setMsg("");
    try {
      const url = urlComFaculdade(`${api}?date=${date}&period=${period}`, escopo);
      const res = await fetch(url, { method: "DELETE", headers: cabecalhosDaEscala(escopo) });
      const json = await res.json();
      setMsg(json.success ? `✅ ${json.data.cancelled} liberação(ões) desfeita(s).` : `❌ ${json.error}`);
      await carregar(date);
      onChanged?.();
    } catch {
      setMsg("❌ Erro ao desfazer.");
    }
    setBusy(false);
  }

  const porTurno = (p: Periodo) => released.filter((r) => r.period === p);
  const totalRemovidos = previa?.reduce((n, p) => n + p.interns.length, 0) ?? 0;
  const totalAbrir = previa?.reduce((n, p) => n + p.open, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-4 text-white">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><Unlock className="h-5 w-5" /> Liberar vagas</h2>
            <p className="text-xs text-violet-100">A faculdade não vai usar as vagas — outras podem pegar</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition hover:bg-white/20" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {pickFaculty && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Faculdade</p>
              <select
                value={faculdadeEscolhida}
                onChange={(e) => { setFaculdadeEscolhida(e.target.value); setMsg(""); }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="">Escolha a faculdade</option>
                {faculdades.map((f) => <option key={f.id} value={f.id}>{f.abbreviation} — {f.name}</option>)}
              </select>
            </div>
          )}

          {/* Passo 1 — o quê */}
          <div className={prontoParaEscolher ? "" : "pointer-events-none opacity-40"}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">1. O que liberar</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([
                { value: "USA", titulo: "Só intervenção", sub: "Vagas de USA (as que o sorteio usa)" },
                { value: "ALL", titulo: "Intervenção e regulação", sub: "USA, CRU e CRL do dia" },
              ] as const).map((op) => (
                <button
                  key={op.value}
                  type="button"
                  onClick={() => { setScope(op.value); setPrevia(null); }}
                  className={`min-h-14 rounded-xl px-3 py-2 text-left transition ${scope === op.value
                    ? "bg-violet-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                >
                  <span className="block text-sm font-bold">{op.titulo}</span>
                  <span className={`block text-[11px] ${scope === op.value ? "text-violet-100" : "text-slate-500"}`}>{op.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Passo 2 — quando */}
          <div className={scope && prontoParaEscolher ? "" : "pointer-events-none opacity-40"}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">2. Quando</p>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => { setDate(e.target.value); setMsg(""); setPrevia(null); }}
              className="mb-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <div className="flex gap-2">
              {([["DAY", "☀️ Diurno"], ["NIGHT", "🌙 Noturno"]] as const).map(([p, label]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => { togglePeriodo(p); setPrevia(null); }}
                  className={`min-h-11 flex-1 rounded-xl text-sm font-bold transition ${periods.has(p)
                    ? "bg-violet-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Já liberadas nesse dia */}
          {date && released.length > 0 && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2 text-xs text-violet-800">
              <p className="mb-1 font-semibold">Já liberadas neste dia</p>
              {(["DAY", "NIGHT"] as const).map((p) => {
                const lista = porTurno(p);
                if (lista.length === 0) return null;
                const emUso = lista.filter((r) => r.claimedBy).length;
                return (
                  <div key={p} className="flex items-center justify-between gap-2 py-0.5">
                    <span>
                      {p === "DAY" ? "☀️" : "🌙"} {lista.length} ({lista.map((r) => r.baseCode).join(", ")})
                      {emUso > 0 && ` · ${emUso} já em uso`}
                    </span>
                    {lista.length > emUso && (
                      <button type="button" disabled={busy} onClick={() => desfazer(p)} className="font-semibold underline disabled:opacity-50">
                        desfazer
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Passo 3 — confirmação: o que vai acontecer */}
          {previa && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <p className="font-bold">3. Confira antes de confirmar</p>
              {previa.map((p) => (
                <div key={p.period} className="mt-1.5">
                  <p>
                    {p.period === "DAY" ? "☀️ Diurno" : "🌙 Noturno"}: {p.open === 0 ? "nenhuma vaga a liberar" : `${p.open} vaga(s) serão liberadas`}
                  </p>
                  {p.interns.length > 0 && (
                    <ul className="ml-4 list-disc text-xs">
                      {p.interns.map((i) => <li key={i.assignmentId}>{i.internName} sai da escala ({i.baseCode})</li>)}
                    </ul>
                  )}
                </div>
              ))}
              {totalRemovidos > 0 && (
                <p className="mt-2 text-xs">
                  {totalRemovidos === 1 ? "Este interno fica" : "Estes internos ficam"} abaixo da meta de plantões e
                  {totalRemovidos === 1 ? " aparece" : " aparecem"} como sub-alocado no dashboard do líder e em Ver interno,
                  para realocar em outro dia.
                </p>
              )}
              {totalRemovidos === 0 && totalAbrir === 0 && (
                <p className="mt-2 text-xs">Nada muda: as vagas deste dia já estão liberadas ou ocupadas por plantão em andamento.</p>
              )}
            </div>
          )}

          {msg && <p className="text-sm">{msg}</p>}
        </div>

        <div className="flex gap-2 border-t border-slate-200 bg-slate-50/50 px-5 py-4">
          {previa ? (
            <>
              <button type="button" onClick={() => setPrevia(null)} className="flex-1 rounded-xl bg-slate-200 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-300">
                Voltar
              </button>
              <button
                type="button"
                onClick={liberar}
                disabled={busy || (totalAbrir === 0 && totalRemovidos === 0)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
                {totalRemovidos > 0 ? `Confirmar e tirar ${totalRemovidos} da escala` : "Confirmar liberação"}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-slate-200 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-300">
                Fechar
              </button>
              <button
                type="button"
                onClick={prever}
                disabled={busy || !scope || !date || periods.size === 0 || !prontoParaEscolher}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />} Liberar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
