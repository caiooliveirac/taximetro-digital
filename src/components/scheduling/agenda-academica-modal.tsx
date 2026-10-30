"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Trash2, X } from "lucide-react";
import { localDateStr } from "@/lib/utils";
import {
  baseDaEscala,
  cabecalhosDaEscala,
  corpoComFaculdade,
  escopoDeEscala,
  urlComFaculdade,
} from "@/features/scheduling/domain/policies/escala-scope";

/**
 * "Agenda da turma": prova, atividade fixa ou aula da faculdade num dia. Os
 * internos do compromisso não são escalados no turno, e, sendo a turma
 * inteira, as vagas da grade vão para as outras faculdades. Pré-visualiza
 * antes de salvar, como o "Liberar vagas". Ver academic-commitments.ts.
 */

type Periodo = "DAY" | "NIGHT";
type Tipo = "PROVA" | "ATIVIDADE" | "AULA";
type Interno = { id: string; name: string };
type Turma = { id: string; startDate: string; endDate: string; name: string | null; label: string; interns: Interno[] };
type Compromisso = {
  id: string; cohortId: string; kind: Tipo; title: string; date: string;
  blocksDay: boolean; blocksNight: boolean; blocksEveNight: boolean; internIds: string[] | null;
};
type TurnoPrevisto = {
  date: string; period: Periodo; open: number;
  interns: { internName: string; baseCode: string }[];
  extras: { internName: string; baseCode: string }[];
};
type Turno = "DAY" | "NIGHT" | "BOTH";

const ROTULO: Record<Tipo, string> = { PROVA: "Prova", ATIVIDADE: "Atividade fixa", AULA: "Aula" };
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function dataCurta(d: string) {
  return `${DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}
function rotuloTurno(p: Periodo) {
  return p === "DAY" ? "diurno" : "noturno";
}
function nomeDaTurma(t: Turma) {
  return t.name ?? t.label;
}

export function AgendaAcademicaButton({ facultyId, onChanged }: { facultyId?: string | null; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-bold text-rose-800 transition hover:bg-rose-100"
      >
        <CalendarClock className="h-4 w-4" /> Agenda da turma
      </button>
      {open && <AgendaAcademicaModal facultyId={facultyId} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

function AgendaAcademicaModal({ facultyId, onClose, onChanged }: {
  facultyId?: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const escopo = escopoDeEscala(facultyId);
  const api = `${baseDaEscala(escopo)}/agenda-academica`;
  const hoje = localDateStr();

  const [turmas, setTurmas] = useState<Turma[]>([]);
  const [compromissos, setCompromissos] = useState<Compromisso[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [cohortId, setCohortId] = useState("");
  const [kind, setKind] = useState<Tipo>("PROVA");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [turno, setTurno] = useState<Turno>("DAY");
  const [vespera, setVespera] = useState(true);
  const [turmaInteira, setTurmaInteira] = useState(true);
  const [grupo, setGrupo] = useState<Set<string>>(new Set());
  // A prévia vale para o formulário de quando foi pedida; mudou algo, some.
  const [previaPedida, setPreviaPedida] = useState<{ chave: string; turnos: TurnoPrevisto[] } | null>(null);

  async function carregar() {
    try {
      const res = await fetch(urlComFaculdade(api, escopo), { cache: "no-store", headers: cabecalhosDaEscala(escopo) });
      const json = await res.json();
      if (!json.success) { setMsg(`❌ ${json.error}`); return; }
      setTurmas(json.data.turmas);
      setCompromissos(json.data.compromissos);
      setCohortId((atual) => atual || json.data.turmas.at(-1)?.id || "");
    } catch {
      setMsg("❌ Erro ao carregar a agenda.");
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => { void carregar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [facultyId]);

  const turma = turmas.find((t) => t.id === cohortId) ?? null;
  const minData = turma ? (turma.startDate > hoje ? turma.startDate : hoje) : hoje;
  const pronto = Boolean(turma && title.trim().length >= 2 && date && (turmaInteira || grupo.size > 0));

  function corpo(preview: boolean) {
    return corpoComFaculdade({
      cohortId, kind, title: title.trim(), date,
      blocksDay: turno !== "NIGHT",
      blocksNight: turno !== "DAY",
      blocksEveNight: turno !== "NIGHT" && vespera,
      internIds: turmaInteira ? null : [...grupo],
      preview,
    }, escopo);
  }

  const chave = JSON.stringify(corpo(false));
  const previa = previaPedida?.chave === chave ? previaPedida.turnos : null;

  async function enviar(preview: boolean) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: cabecalhosDaEscala(escopo, { "Content-Type": "application/json" }),
        body: JSON.stringify(corpo(preview)),
      });
      const json = await res.json();
      if (!json.success) { setMsg(`❌ ${json.error}`); return; }
      if (preview) { setPreviaPedida({ chave, turnos: json.data.turnos }); return; }
      const vagas = (json.data.turnos as TurnoPrevisto[]).reduce((n, t) => n + t.open, 0);
      const saem = (json.data.turnos as TurnoPrevisto[]).reduce((n, t) => n + t.interns.length, 0);
      setMsg(`✅ Compromisso salvo${vagas ? `, ${vagas} vaga(s) para outras faculdades` : ""}${saem ? `, ${saem} interno(s) fora da escala` : ""}.`);
      setPreviaPedida(null);
      setTitle("");
      await carregar();
      onChanged?.();
    } catch {
      setMsg("❌ Erro ao salvar o compromisso.");
    } finally {
      setBusy(false);
    }
  }

  async function apagar(c: Compromisso) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(urlComFaculdade(`${api}?id=${c.id}`, escopo), { method: "DELETE", headers: cabecalhosDaEscala(escopo) });
      const json = await res.json();
      setMsg(json.success
        ? `✅ "${c.title}" apagado${json.data.ofertasCanceladas ? `; ${json.data.ofertasCanceladas} vaga(s) não pegas voltaram para a grade` : ""}. Quem saiu da escala não volta sozinho.`
        : `❌ ${json.error}`);
      await carregar();
      onChanged?.();
    } catch {
      setMsg("❌ Erro ao apagar.");
    } finally {
      setBusy(false);
    }
  }

  function alternarInterno(id: string) {
    setGrupo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const nomes = new Map(turmas.flatMap((t) => t.interns.map((i) => [i.id, i.name] as const)));
  const totalVagas = previa?.reduce((n, t) => n + t.open, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between bg-gradient-to-r from-rose-500 to-pink-600 px-5 py-4 text-white">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><CalendarClock className="h-5 w-5" /> Agenda da turma</h2>
            <p className="text-xs text-rose-100">Prova ou atividade fixa: a turma não é escalada no turno</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 transition hover:bg-white/20" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          {carregando ? (
            <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>
          ) : turmas.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma turma em andamento ou planejada nesta faculdade.</p>
          ) : (
            <>
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Já lançados</p>
                {compromissos.length === 0 ? (
                  <p className="text-sm text-slate-400">Nenhum compromisso daqui para frente.</p>
                ) : (
                  <ul className="space-y-2">
                    {compromissos.map((c) => {
                      const turnos = [c.blocksDay && "diurno", c.blocksNight && "noturno"].filter(Boolean).join(" e ");
                      const t = turmas.find((x) => x.id === c.cohortId);
                      return (
                        <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold text-slate-900">{c.title}</p>
                            <p className="text-xs text-slate-600">
                              <span className="font-semibold text-rose-700">{ROTULO[c.kind]}</span> · {dataCurta(c.date)} · {turnos}
                              {c.blocksEveNight && " + noite da véspera"}
                            </p>
                            <p className="text-xs text-slate-500">
                              {t && turmas.length > 1 ? `${nomeDaTurma(t)} · ` : ""}
                              {c.internIds ? c.internIds.map((id) => nomes.get(id) ?? "interno").join(", ") : "turma inteira"}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => apagar(c)}
                            className="shrink-0 rounded-lg p-2 text-slate-500 transition hover:bg-rose-100 hover:text-rose-700 disabled:opacity-50"
                            aria-label={`Apagar ${c.title}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="space-y-3 border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Novo compromisso</p>

                {turmas.length > 1 && (
                  <select id="agenda-turma" value={cohortId} onChange={(e) => { setCohortId(e.target.value); setGrupo(new Set()); }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                    {turmas.map((t) => (
                      <option key={t.id} value={t.id}>{nomeDaTurma(t)} ({t.startDate.slice(8, 10)}/{t.startDate.slice(5, 7)} a {t.endDate.slice(8, 10)}/{t.endDate.slice(5, 7)})</option>
                    ))}
                  </select>
                )}

                <input id="agenda-titulo" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
                  placeholder="O que é (ex.: Prova de Clínica Médica)"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />

                <div className="grid grid-cols-2 gap-2">
                  <select id="agenda-tipo" value={kind} onChange={(e) => setKind(e.target.value as Tipo)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                    <option value="PROVA">Prova</option>
                    <option value="ATIVIDADE">Atividade fixa</option>
                    <option value="AULA">Aula</option>
                  </select>
                  <input id="agenda-data" type="date" value={date} min={minData} max={turma?.endDate}
                    onChange={(e) => setDate(e.target.value)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {([["DAY", "☀️ Diurno"], ["NIGHT", "🌙 Noturno"], ["BOTH", "Dia inteiro"]] as const).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setTurno(v)} aria-pressed={turno === v}
                      className={`rounded-xl border px-2 py-2 text-sm font-semibold transition ${turno === v ? "border-rose-400 bg-rose-50 text-rose-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {turno !== "NIGHT" && (
                  <label htmlFor="agenda-vespera" className="flex items-start gap-2 text-sm text-slate-700">
                    <input id="agenda-vespera" type="checkbox" checked={vespera} onChange={(e) => setVespera(e.target.checked)} className="mt-0.5" />
                    Bloquear também o noturno da véspera (plantão vai até 7h)
                  </label>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {([[true, "Turma inteira"], [false, "Parte da turma"]] as const).map(([v, label]) => (
                    <button key={label} type="button" onClick={() => setTurmaInteira(v)} aria-pressed={turmaInteira === v}
                      className={`rounded-xl border px-2 py-2 text-sm font-semibold transition ${turmaInteira === v ? "border-rose-400 bg-rose-50 text-rose-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                      {label}
                    </button>
                  ))}
                </div>

                {!turmaInteira && turma && (
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-1.5">
                      {turma.interns.map((i) => (
                        <label key={i.id} htmlFor={`agenda-int-${i.id}`}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${grupo.has(i.id) ? "border-rose-400 bg-rose-50 text-rose-800" : "border-slate-200 text-slate-600"}`}>
                          <input id={`agenda-int-${i.id}`} type="checkbox" checked={grupo.has(i.id)} onChange={() => alternarInterno(i.id)} className="h-3 w-3" />
                          {i.name}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">Só esses ficam bloqueados. As vagas da grade continuam da turma, para os colegas livres.</p>
                  </div>
                )}

                {previa && (
                  <div className="space-y-1.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    <p className="font-semibold">Ao salvar</p>
                    <ul className="list-disc space-y-1 pl-5 text-xs">
                      {previa.map((t) => (
                        <li key={`${t.date}${t.period}`}>
                          <strong>{dataCurta(t.date)} {rotuloTurno(t.period)}:</strong>{" "}
                          {t.open > 0 ? `${t.open} vaga(s) para outras faculdades` : turmaInteira ? "nenhuma vaga a ceder (já cedidas, ocupadas por outra turma ou sem grade)" : "vagas ficam com a turma"}
                          {t.interns.length > 0 && <> · saem: {t.interns.map((i) => `${i.internName} (${i.baseCode})`).join(", ")}</>}
                          {t.extras.length > 0 && <> · <span className="font-semibold">extra para resolver à mão:</span> {t.extras.map((i) => `${i.internName} (${i.baseCode})`).join(", ")}</>}
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs">Esses internos não entram no sorteio, na alocação, no CRU fixo nem em vaga livre nesses turnos.</p>
                  </div>
                )}

                {msg && <p className="text-sm text-slate-700">{msg}</p>}

                <button
                  type="button"
                  disabled={!pronto || busy}
                  onClick={() => enviar(!previa)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {previa ? `Salvar compromisso${totalVagas ? ` e ceder ${totalVagas} vaga(s)` : ""}` : "Ver o que acontece"}
                </button>
              </section>
            </>
          )}
          {turmas.length === 0 && msg && <p className="text-sm text-slate-700">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
