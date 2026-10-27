"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Unlock } from "lucide-react";

/**
 * Liberação automática de vagas, por faculdade. A data vem da turma (não se
 * edita aqui: muda na tela de Turmas); o prazo e o liga/desliga se salvam.
 * Regra e teto por base: auto-release-policy.ts.
 */

type Turma = { id: string; nome: string; startDate: string; endDate: string; status: string; liberaEm: string };
type Faculdade = {
  facultyId: string;
  abbreviation: string;
  name: string;
  enabled: boolean;
  deadlineDays: number;
  enabledSince: string;
  saved: boolean;
  turmas: Turma[];
  liberadasAbertas: number;
  liberadasUsadas: number;
};
type Overview = { today: string; faculdades: Faculdade[]; semDono: { ate: string | null; abertas: number; usadas: number } };
type Run = { skipped?: string; created: number; semDono: number; withdrawn: number };

const API = "/taximetro/api/admin/vagas-livres";

function br(date: string) {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}
function menosUmDia(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function resumoRun(run: Run) {
  if (run.skipped) return `Não rodou: ${run.skipped}.`;
  if (run.created === 0 && run.withdrawn === 0) return "Nada novo para liberar.";
  const partes = [`${run.created - run.semDono} pelo prazo`, `${run.semDono} sem dono`];
  if (run.withdrawn > 0) partes.push(`${run.withdrawn} retiradas (voltaram à faculdade ou passaram do teto da base)`);
  return `Liberadas agora: ${partes.join(", ")}.`;
}

export function VagasLivresConfig() {
  const [data, setData] = useState<Overview | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");

  async function load() {
    try {
      const res = await fetch(API, { cache: "no-store" });
      const json = await res.json();
      if (json.success) setData(json.data);
      else setErro(json.error ?? "Erro ao carregar.");
    } catch {
      setErro("Erro ao carregar.");
    }
  }
  useEffect(() => { load(); }, []);

  async function enviar(method: "PUT" | "POST", body: unknown, chave: string) {
    setBusy(chave);
    setErro("");
    setMsg("");
    try {
      const res = await fetch(API, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json();
      if (!json.success) {
        setErro(json.error ?? "Erro ao salvar.");
      } else {
        setData(json.data.overview);
        setMsg(resumoRun(json.data.run));
      }
    } catch {
      setErro("Erro ao salvar.");
    }
    setBusy("");
  }

  function salvar(f: Faculdade, mudanca: { enabled?: boolean; deadlineDays?: number }) {
    const deadlineDays = mudanca.deadlineDays ?? f.deadlineDays;
    setRascunho((r) => { const resto = { ...r }; delete resto[f.facultyId]; return resto; });
    return enviar("PUT", { facultyId: f.facultyId, enabled: mudanca.enabled ?? f.enabled, deadlineDays }, f.facultyId);
  }

  if (!data) {
    return <p className="py-10 text-center text-sm text-slate-400">{erro || "Carregando…"}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold">Vagas livres</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Cada turma tem um prazo, contado do início dela, para escalar os internos nas vagas da grade.
            Vaga não usada no prazo vira vaga livre: qualquer líder de outra faculdade pode escalar nela.
            O líder da faculdade ainda pode desfazer na Montar Escala enquanto ninguém tiver pegado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => enviar("POST", {}, "run")}
          disabled={busy !== ""}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy === "run" ? "animate-spin" : ""}`} />
          Rodar agora
        </button>
      </div>

      {msg && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p className="font-semibold text-slate-900">Vagas sem dono</p>
        <p className="mt-1">
          Capacidade da base que nenhuma faculdade tem na grade fica livre desde já, nos dias do rodízio das turmas abertas
          {data.semDono.ate ? <> (hoje até <span className="font-semibold text-slate-900">{br(data.semDono.ate)}</span>, fim da última turma)</> : " (nenhuma turma aberta agora)"}.
          Diurno: duas por USA, menos BR60, BR05, PM04 e PM40 (só uma). Noturno: uma, e duas só na SM01, CB02, PR03, CN10 e CC70.
        </p>
        <p className="mt-2 text-slate-900">
          <span className="font-semibold">{data.semDono.abertas}</span> abertas ·{" "}
          <span className="font-semibold">{data.semDono.usadas}</span> já usadas
        </p>
      </div>

      <div className="space-y-3">
        {data.faculdades.map((f) => {
          const valor = rascunho[f.facultyId] ?? String(f.deadlineDays);
          const dias = Number(valor);
          const mudou = valor !== String(f.deadlineDays);
          const valido = Number.isInteger(dias) && dias >= 0 && dias <= 30;
          return (
            <div key={f.facultyId} className={`rounded-xl border bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${f.enabled ? "border-slate-200" : "border-slate-200 opacity-75"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{f.abbreviation}</p>
                  <p className="truncate text-xs text-slate-500">{f.name}</p>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  Prazo
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={valor}
                    disabled={!f.enabled || busy !== ""}
                    onChange={(e) => setRascunho((r) => ({ ...r, [f.facultyId]: e.target.value }))}
                    className="w-16 rounded-md border border-slate-200 px-2 py-1 text-right tabular-nums disabled:bg-slate-50"
                  />
                  dias
                </label>
                {mudou && (
                  <button
                    type="button"
                    disabled={!valido || busy !== ""}
                    onClick={() => salvar(f, { deadlineDays: dias })}
                    className="rounded-md bg-accent-500 px-3 py-1 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
                  >
                    Salvar
                  </button>
                )}

                <button
                  type="button"
                  role="switch"
                  aria-checked={f.enabled}
                  aria-label={`Liberação automática da ${f.abbreviation}`}
                  disabled={busy !== ""}
                  onClick={() => salvar(f, { enabled: !f.enabled })}
                  className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  title={f.enabled ? "Toque para desligar: as vagas desta faculdade não são mais liberadas" : "Toque para ligar: o prazo recomeça a contar de hoje"}
                >
                  <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${f.enabled ? "bg-emerald-500" : "bg-slate-300"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${f.enabled ? "left-[18px]" : "left-0.5"}`} />
                  </span>
                  <span className="font-medium">{f.enabled ? "Liberação ligada" : "Liberação desligada"}</span>
                </button>
              </div>

              <div className="mt-3 space-y-1.5">
                {f.turmas.length === 0 && <p className="text-xs text-slate-400">Nenhuma turma em andamento ou marcada.</p>}
                {f.turmas.map((t) => {
                  const liberando = f.enabled && data.today >= t.liberaEm;
                  return (
                    <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                      <span className="font-medium text-slate-800">{t.nome}</span>
                      <span>{br(t.startDate)} → {br(t.endDate)}</span>
                      {!f.enabled ? (
                        <span className="text-slate-400">não libera</span>
                      ) : liberando ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 font-medium text-teal-800">
                          <Unlock className="h-3 w-3" /> liberando desde {br(t.liberaEm)}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">
                          escala até {br(menosUmDia(t.liberaEm))}, libera em {br(t.liberaEm)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {(f.liberadasAbertas > 0 || f.liberadasUsadas > 0) && (
                <p className="mt-2 text-xs text-slate-500">
                  Liberadas pelo prazo: <span className="font-semibold text-slate-700">{f.liberadasAbertas}</span> abertas ·{" "}
                  <span className="font-semibold text-slate-700">{f.liberadasUsadas}</span> usadas por outras faculdades
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
