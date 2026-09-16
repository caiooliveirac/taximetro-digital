"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  GripVertical,
  Loader2,
  Power,
  PowerOff,
  Radio,
  RefreshCw,
  Stethoscope,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getFacultyStyle } from "@/lib/base-colors";

/**
 * Plantão ao vivo: o turno em andamento, base por base, do jeito que o interno
 * vê a grade de remanejamento — mas com nome em cada célula e com as mãos
 * livres para intervir do celular.
 *
 * - Arrastar um interno pela alça (ou pelo chip, no mouse) e soltar em outra
 *   base o remaneja; tocar no chip abre a folha com o mesmo "mover" e o
 *   "repor em outro dia".
 * - Base com aviso do interno mostra quem avisou e o quê, e tem "falso alarme".
 * - "Parar base" fecha a base para quem procura vaga, com motivo; "reabrir"
 *   desfaz. Desativação no `plantoes` aparece, mas é deles.
 * - "Repor em outro dia" é para quando já não há vaga em lugar nenhum: o
 *   plantão de hoje sai da conta sem virar falta, e o interno é avisado.
 *
 * A tela se atualiza sozinha a cada 30 s enquanto ninguém está no meio de
 * uma ação.
 */

type Ocupante = {
  assignmentId: string;
  internId: string;
  interno: string;
  faculdade: string;
  facultyName: string | null;
  status: string;
  remanejado: boolean;
};

type Celula =
  | { tipo: "livre" }
  | { tipo: "ocupada"; faculdade: string; estado: "sem-checkin" | "checkin-ok" | "saiu" | "remanejado"; reivindicavel: boolean; ocupante: Ocupante }
  | { tipo: "extra"; reservadaPara: string | null; ocupavel: boolean };

type Aviso = { assignmentId: string | null; interno: string | null; codigo: string | null; tipo: string; hora: string };

type Base = {
  id: string;
  code: string;
  name: string;
  capacity: number;
  limite: number;
  aviso: Aviso | null;
  avisos: Aviso[];
  parada: { desde: string; motivo: string | null } | null;
  desativada: { desde: string | null; motivo: string | null } | null;
  medicos: string[];
  aceitaMais: boolean;
  celulas: Celula[];
};

type Liberado = { assignmentId: string; internId: string; interno: string; faculdade: string; baseCode: string; hora: string | null };

type Turno = {
  date: string;
  period: "DAY" | "NIGHT";
  agora: string;
  tolerancia: { abreAs: string; reivindicaAs: string; aberta: boolean; reivindicando: boolean };
  medicosDisponiveis: boolean;
  bases: Base[];
  liberados: Liberado[];
};

type Acao =
  | { acao: "mover"; assignmentId: string; newBaseId: string; motivo?: string }
  | { acao: "cancelarAviso"; baseId: string }
  | { acao: "pararBase"; baseId: string; motivo?: string }
  | { acao: "reabrirBase"; baseId: string }
  | { acao: "repor"; assignmentId: string; motivo?: string }
  | { acao: "desfazerRepor"; assignmentId: string };

type Movendo = { ocupante: Ocupante; origemId: string; origemCode: string };

const ATUALIZACAO_MS = 30_000;
const ARRASTE_MIN_PX = 8;

async function buscarTurno(): Promise<{ turno: Turno } | { erro: string }> {
  try {
    const res = await fetch("/taximetro/api/admin/plantao-ao-vivo", { cache: "no-store" });
    const json = await res.json();
    return json.success ? { turno: json.data } : { erro: json.error ?? "Não foi possível carregar o turno." };
  } catch {
    return { erro: "Erro de conexão. Tente novamente." };
  }
}

function formatarData(date: string) {
  return new Date(date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function rotuloDoEstado(estado: Extract<Celula, { tipo: "ocupada" }>["estado"]) {
  return { "checkin-ok": "check-in ok", saiu: "já saiu", remanejado: "remanejado, a caminho", "sem-checkin": "sem check-in" }[estado];
}

const CELULA = "relative w-full rounded-md border px-2 py-1.5 text-left text-xs leading-tight";

function classeDaCelula(c: Celula, reivindicando: boolean) {
  if (c.tipo === "livre") return `${CELULA} border-dashed border-emerald-300 bg-emerald-50/60 text-emerald-800`;
  if (c.tipo === "extra") return `${CELULA} border-dashed ${c.ocupavel ? "border-emerald-200 bg-white text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-400"}`;
  switch (c.estado) {
    case "checkin-ok":
      return `${CELULA} border-emerald-300 bg-emerald-50 text-emerald-900`;
    case "remanejado":
      return `${CELULA} border-sky-300 bg-sky-50 text-sky-900`;
    case "saiu":
      return `${CELULA} border-slate-200 bg-slate-50 text-slate-500`;
    default:
      return `${CELULA} ${reivindicando ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-700"}`;
  }
}

export function PlantaoAoVivo() {
  const [turno, setTurno] = useState<Turno | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const [folha, setFolha] = useState<{ ocupante: Ocupante; base: Base } | null>(null);
  const [movendo, setMovendo] = useState<Movendo | null>(null);
  const [parando, setParando] = useState<{ base: Base; motivo: string } | null>(null);
  const [arraste, setArraste] = useState<{ ocupante: Ocupante; x: number; y: number; alvoId: string | null } | null>(null);

  // Estado do ponteiro fora do React: o move dispara dezenas de vezes por segundo.
  const ponteiro = useRef<{
    id: number;
    x: number;
    y: number;
    ocupante: Ocupante;
    origemId: string;
    origemCode: string;
    arrastando: boolean;
    alvoId: string | null;
  } | null>(null);

  const receber = useCallback((r: Awaited<ReturnType<typeof buscarTurno>>) => {
    if ("turno" in r) setTurno(r.turno);
    else setMsg({ ok: false, texto: r.erro });
    setCarregando(false);
  }, []);

  const carregar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setCarregando(true);
      receber(await buscarTurno());
    },
    [receber],
  );

  useEffect(() => {
    // `carregando` já nasce true; o estado só muda quando a resposta chega.
    let ativo = true;
    buscarTurno().then((r) => {
      if (ativo) receber(r);
    });
    return () => {
      ativo = false;
    };
  }, [receber]);

  const emAcao = ocupado || folha !== null || movendo !== null || parando !== null || arraste !== null;
  useEffect(() => {
    if (emAcao) return;
    const t = setInterval(() => carregar(true), ATUALIZACAO_MS);
    return () => clearInterval(t);
  }, [emAcao, carregar]);

  async function executar(acao: Acao, sucesso: (data: Record<string, unknown>) => string): Promise<boolean> {
    setOcupado(true);
    setMsg(null);
    try {
      const res = await fetch("/taximetro/api/admin/plantao-ao-vivo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(acao),
      });
      const json = await res.json();
      if (json.success) {
        setMsg({ ok: true, texto: sucesso(json.data ?? {}) });
        await carregar(true);
        return true;
      }
      setMsg({ ok: false, texto: json.error ?? "Não foi possível concluir." });
      await carregar(true);
      return false;
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão. Tente novamente." });
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const avisoDeEntrega = (data: Record<string, unknown>) =>
    data.entregue ? " Interno avisado no Telegram." : " O interno não tem Telegram vinculado — avise por outro canal.";

  async function mover(ocupante: Ocupante, origemCode: string, destino: Base) {
    if (!destino.aceitaMais) {
      setMsg({ ok: false, texto: `A ${destino.code} não recebe ninguém agora.` });
      return;
    }
    if (!window.confirm(`Mover ${ocupante.interno} (${ocupante.faculdade}) da ${origemCode} para a ${destino.code} — ${destino.name}?`)) return;
    const ok = await executar(
      { acao: "mover", assignmentId: ocupante.assignmentId, newBaseId: destino.id },
      (d) => `${d.interno} agora está na ${d.para}.${avisoDeEntrega(d)}`,
    );
    if (ok) setMovendo(null);
  }

  async function repor(ocupante: Ocupante, base: Base) {
    const motivo = base.parada?.motivo ?? base.aviso?.tipo ?? null;
    if (
      !window.confirm(
        `Liberar ${ocupante.interno} (${ocupante.faculdade}) do plantão de hoje na ${base.code}${motivo ? ` (${motivo})` : ""}?\n\nNão vira falta e não conta para a meta: ele repõe em outro dia. Dá para desfazer nesta tela.`,
      )
    )
      return;
    const ok = await executar(
      { acao: "repor", assignmentId: ocupante.assignmentId },
      (d) => `${d.interno} liberado para repor em outro dia.${avisoDeEntrega(d)}`,
    );
    if (ok) setFolha(null);
  }

  async function desfazerRepor(l: Liberado) {
    if (!window.confirm(`Desfazer a liberação de ${l.interno}? O plantão de hoje na ${l.baseCode} volta a valer.`)) return;
    await executar({ acao: "desfazerRepor", assignmentId: l.assignmentId }, (d) => `Plantão de ${d.interno} na ${d.baseCode} de volta.${avisoDeEntrega(d)}`);
  }

  async function cancelarAviso(base: Base) {
    const quem = base.aviso?.interno ? ` de ${base.aviso.interno}` : "";
    if (!window.confirm(`Falso alarme: cancelar o aviso${quem} na ${base.code}?\n\nA base volta a oferecer vaga, e quem avisou perde a grade até avisar de novo.`)) return;
    await executar({ acao: "cancelarAviso", baseId: base.id }, (d) => `Aviso da ${d.baseCode} cancelado.`);
  }

  async function pararBase() {
    if (!parando) return;
    const ok = await executar(
      { acao: "pararBase", baseId: parando.base.id, motivo: parando.motivo.trim() || undefined },
      (d) => `${d.baseCode} parada neste turno. Quem está lá continua visível; ninguém novo entra.`,
    );
    if (ok) setParando(null);
  }

  async function reabrirBase(base: Base) {
    if (!window.confirm(`Reabrir a ${base.code}? Ela volta a oferecer vaga neste turno.`)) return;
    await executar({ acao: "reabrirBase", baseId: base.id }, (d) => `${d.baseCode} reaberta.`);
  }

  // --- arrastar e soltar -------------------------------------------------

  function alvoEm(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-base-id]");
    return el?.dataset.baseId ?? null;
  }

  function aoApertar(e: React.PointerEvent<HTMLButtonElement>, ocupante: Ocupante, base: Base) {
    if (ocupado || e.button !== 0) return;
    // No toque, só a alça arrasta — o resto do chip é para rolar a página e tocar.
    const pelaAlca = (e.target as HTMLElement).closest("[data-alca]") !== null;
    if (e.pointerType !== "mouse" && !pelaAlca) return;
    ponteiro.current = { id: e.pointerId, x: e.clientX, y: e.clientY, ocupante, origemId: base.id, origemCode: base.code, arrastando: false, alvoId: null };
  }

  function aoMover(e: React.PointerEvent<HTMLButtonElement>) {
    const p = ponteiro.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.arrastando) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < ARRASTE_MIN_PX) return;
      p.arrastando = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    p.alvoId = alvoEm(e.clientX, e.clientY);
    setArraste({ ocupante: p.ocupante, x: e.clientX, y: e.clientY, alvoId: p.alvoId });
  }

  function aoSoltar(e: React.PointerEvent<HTMLButtonElement>) {
    const p = ponteiro.current;
    if (!p || p.id !== e.pointerId) return;
    ponteiro.current = null;
    if (!p.arrastando) return; // toque simples: o onClick abre a folha
    e.preventDefault();
    setArraste(null);
    const destino = p.alvoId && p.alvoId !== p.origemId ? turno?.bases.find((b) => b.id === p.alvoId) : null;
    if (destino) void mover(p.ocupante, p.origemCode, destino);
  }

  function aoCancelarArraste(e: React.PointerEvent<HTMLButtonElement>) {
    if (ponteiro.current?.id === e.pointerId) ponteiro.current = null;
    setArraste(null);
  }

  function aoTocar(ocupante: Ocupante, base: Base) {
    // O pointerup de um arraste chega antes do click; o ref já foi zerado.
    if (arraste) return;
    if (movendo) return;
    setFolha({ ocupante, base });
  }

  // --- render ---------------------------------------------------------------

  const resumo = turno
    ? {
        avisos: turno.bases.filter((b) => b.aviso).length,
        paradas: turno.bases.filter((b) => b.parada || b.desativada).length,
        livres: turno.bases.reduce((n, b) => n + b.celulas.filter((c) => c.tipo === "livre").length, 0),
        liberados: turno.liberados.length,
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-accent-600">Operação</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
            <Radio className="h-6 w-6 text-accent-600" strokeWidth={1.8} /> Plantão ao vivo
          </h1>
          <p className="text-sm text-slate-500">
            {turno
              ? `Turno ${turno.period === "DAY" ? "diurno" : "noturno"} de ${formatarData(turno.date)} · atualizado às ${turno.agora}`
              : "O turno em andamento, base por base."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => carregar()} disabled={carregando || ocupado} className="self-start">
          <RefreshCw className={`h-4 w-4 ${carregando ? "animate-spin" : ""}`} /> Atualizar
        </Button>
      </div>

      {resumo && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-3 py-1 font-medium ${resumo.avisos > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
            {resumo.avisos} com aviso
          </span>
          <span className={`rounded-full px-3 py-1 font-medium ${resumo.paradas > 0 ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-500"}`}>
            {resumo.paradas} parada{resumo.paradas === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">{resumo.livres} vaga{resumo.livres === 1 ? "" : "s"} na grade</span>
          <span className={`rounded-full px-3 py-1 font-medium ${resumo.liberados > 0 ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-500"}`}>
            {resumo.liberados} para repor
          </span>
        </div>
      )}

      {turno && !turno.tolerancia.aberta && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          A grade abre para o interno às {turno.tolerancia.abreAs}. A coordenação pode mover desde já.
        </p>
      )}

      {msg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.texto}
        </div>
      )}

      {movendo && (
        <div className="sticky top-2 z-30 flex items-center justify-between gap-3 rounded-xl border border-accent-300 bg-accent-50 px-4 py-3 shadow-md">
          <p className="text-sm text-slate-900">
            Movendo <span className="font-semibold">{movendo.ocupante.interno}</span> ({movendo.ocupante.faculdade}) da {movendo.origemCode}.
            <span className="block text-xs text-slate-600">Toque na base de destino.</span>
          </p>
          <Button variant="outline" size="sm" onClick={() => setMovendo(null)}>
            <X className="h-4 w-4" /> Cancelar
          </Button>
        </div>
      )}

      {carregando && !turno ? (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500 shadow-sm">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando o turno...
        </div>
      ) : turno ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {turno.bases.map((b) => {
            const alvo = arraste?.alvoId === b.id;
            const destinoPossivel = (movendo !== null && movendo.origemId !== b.id) || (arraste !== null && !alvo);
            const fechada = b.parada !== null || b.desativada !== null;
            return (
              <section
                key={b.id}
                data-base-id={b.id}
                onClick={() => {
                  if (movendo && b.id !== movendo.origemId) void mover(movendo.ocupante, movendo.origemCode, b);
                }}
                className={`rounded-2xl border bg-white p-3 shadow-sm transition ${
                  alvo
                    ? b.aceitaMais
                      ? "border-emerald-400 ring-2 ring-emerald-300"
                      : "border-red-300 ring-2 ring-red-200"
                    : destinoPossivel && b.aceitaMais
                      ? "border-emerald-200 ring-1 ring-emerald-100"
                      : fechada
                        ? "border-red-200"
                        : b.aviso
                          ? "border-amber-200"
                          : "border-slate-200"
                } ${movendo && b.id !== movendo.origemId && b.aceitaMais ? "cursor-pointer" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900">
                      {b.code} <span className="font-normal text-slate-500">— {b.name}</span>
                    </p>
                    {turno.medicosDisponiveis && (
                      <p className="flex items-center gap-1 text-xs text-slate-500">
                        <Stethoscope className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {b.medicos.length > 0 ? `Dr(a). ${b.medicos.join(", ")}` : "sem médico registrado"}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {movendo && b.id !== movendo.origemId && b.aceitaMais && (
                      <Button size="sm" disabled={ocupado} onClick={(e) => { e.stopPropagation(); void mover(movendo.ocupante, movendo.origemCode, b); }}>
                        <ArrowRightLeft className="h-4 w-4" /> Para cá
                      </Button>
                    )}
                    {!movendo && !b.parada && !b.desativada && (
                      <Button variant="ghost" size="sm" disabled={ocupado} onClick={(e) => { e.stopPropagation(); setParando({ base: b, motivo: "" }); }} className="text-red-700 hover:bg-red-50">
                        <PowerOff className="h-4 w-4" /> Parar
                      </Button>
                    )}
                    {!movendo && b.parada && (
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={(e) => { e.stopPropagation(); void reabrirBase(b); }}>
                        <Power className="h-4 w-4" /> Reabrir
                      </Button>
                    )}
                  </div>
                </div>

                {b.parada && (
                  <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                    Parada pela coordenação às {b.parada.desde}
                    {b.parada.motivo ? ` — ${b.parada.motivo}` : ""}
                  </p>
                )}
                {b.desativada && (
                  <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                    Desativada no plantões{b.desativada.desde ? ` desde ${b.desativada.desde}` : ""}
                    {b.desativada.motivo ? ` — ${b.desativada.motivo}` : ""}
                  </p>
                )}
                {b.aviso && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <p className="text-xs text-amber-900">
                      <TriangleAlert className="mr-1 inline h-3.5 w-3.5" strokeWidth={2} />
                      <span className="font-semibold">{b.aviso.tipo}</span> às {b.aviso.hora}
                      {b.aviso.interno ? ` por ${b.aviso.interno}` : ""}
                      {b.avisos.length > 1 ? ` (+${b.avisos.length - 1})` : ""}
                    </p>
                    {!movendo && (
                      <Button variant="outline" size="sm" disabled={ocupado} onClick={(e) => { e.stopPropagation(); void cancelarAviso(b); }} className="shrink-0">
                        Falso alarme
                      </Button>
                    )}
                  </div>
                )}

                {/* Duas colunas no celular: com nome na célula, três não cabem em 390 px. */}
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {b.celulas.length === 0 && (
                    <span className="col-span-2 text-xs text-slate-400 sm:col-span-3">{fechada || b.aviso ? "sem vaga oferecida" : "sem grade neste turno"}</span>
                  )}
                  {b.celulas.map((c, i) => {
                    if (c.tipo === "ocupada") {
                      const fs = getFacultyStyle(c.ocupante.faculdade);
                      const emArraste = arraste?.ocupante.assignmentId === c.ocupante.assignmentId;
                      return (
                        <button
                          key={c.ocupante.assignmentId}
                          type="button"
                          disabled={ocupado}
                          onPointerDown={(e) => aoApertar(e, c.ocupante, b)}
                          onPointerMove={aoMover}
                          onPointerUp={aoSoltar}
                          onPointerCancel={aoCancelarArraste}
                          onClick={(e) => { e.stopPropagation(); aoTocar(c.ocupante, b); }}
                          className={`${classeDaCelula(c, turno.tolerancia.reivindicando)} flex items-stretch gap-1 pl-1 ${emArraste ? "opacity-40" : ""} ${movendo?.ocupante.assignmentId === c.ocupante.assignmentId ? "ring-2 ring-accent-300" : ""}`}
                        >
                          <span data-alca className="flex shrink-0 cursor-grab touch-none items-center text-slate-400 active:cursor-grabbing" aria-label="arrastar">
                            <GripVertical className="h-4 w-4" strokeWidth={1.8} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{c.ocupante.interno}</span>
                            <span className="flex items-center gap-1 text-[10px] opacity-90">
                              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 ${fs.pill}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${fs.dot}`} />
                                {c.ocupante.faculdade}
                              </span>
                              <span className="truncate">{rotuloDoEstado(c.estado)}</span>
                            </span>
                          </span>
                        </button>
                      );
                    }
                    const titulo = c.tipo === "livre" ? "Livre" : c.ocupavel ? "Cabe mais um" : "Extra";
                    const detalhe = c.tipo === "livre" ? "vaga da grade" : "além da grade";
                    return (
                      <div key={i} className={`${classeDaCelula(c, false)} font-medium`}>
                        <span className="block">{titulo}</span>
                        <span className="block text-[10px] opacity-80">{detalhe}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {turno && turno.liberados.length > 0 && (
        <section className="rounded-2xl border border-sky-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CalendarClock className="h-4 w-4 text-sky-700" strokeWidth={1.8} /> Liberados para repor em outro dia
          </h2>
          <p className="mt-1 text-xs text-slate-500">O plantão de hoje saiu da conta sem virar falta. O interno vê o aviso no app e as vagas abertas para repor.</p>
          <ul className="mt-3 divide-y divide-slate-100">
            {turno.liberados.map((l) => {
              const fs = getFacultyStyle(l.faculdade);
              return (
                <li key={l.assignmentId} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{l.interno}</p>
                    <p className="flex items-center gap-2 text-xs text-slate-500">
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 ${fs.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${fs.dot}`} />
                        {l.faculdade}
                      </span>
                      {l.baseCode}
                      {l.hora ? ` · liberado às ${l.hora}` : ""}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={ocupado} onClick={() => desfazerRepor(l)}>
                    <Undo2 className="h-4 w-4" /> Desfazer
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {turno && (
        <p className="text-xs text-slate-400">
          Arraste pela alça (ou toque no interno) para mover. Célula verde tem check-in; âmbar, sem check-in depois das {turno.tolerancia.reivindicaAs}; azul,
          remanejado a caminho. Tudo fica registrado em Atividades.
        </p>
      )}

      {arraste && (
        <div
          className="pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-accent-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 shadow-xl"
          style={{ left: arraste.x, top: arraste.y }}
        >
          {arraste.ocupante.interno}
          <span className="block text-[10px] font-normal text-slate-500">{arraste.alvoId ? "solte para mover" : "arraste até uma base"}</span>
        </div>
      )}

      {folha && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-slate-950/45" onClick={() => setFolha(null)} />
          <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="border-b border-slate-100 pb-3">
              <p className="text-sm font-medium text-accent-600">{folha.base.code} — {folha.base.name}</p>
              <h3 className="text-xl font-semibold text-slate-900">{folha.ocupante.interno}</h3>
              <p className="text-sm text-slate-500">
                {folha.ocupante.facultyName ?? folha.ocupante.faculdade} · {folha.ocupante.status === "CHECKED_IN" ? "check-in feito" : folha.ocupante.status === "CHECKED_OUT" ? "já saiu" : "sem check-in"}
                {folha.ocupante.remanejado ? " · remanejado" : ""}
              </p>
            </div>
            <div className="mt-4 space-y-2">
              <Button
                className="w-full justify-start"
                variant="outline"
                disabled={ocupado || folha.ocupante.status === "CHECKED_OUT"}
                onClick={() => {
                  setMovendo({ ocupante: folha.ocupante, origemId: folha.base.id, origemCode: folha.base.code });
                  setFolha(null);
                }}
              >
                <ArrowRightLeft className="h-4 w-4" /> Mover para outra base
              </Button>
              <Button
                className="w-full justify-start"
                variant="outline"
                disabled={ocupado || folha.ocupante.status === "CHECKED_OUT"}
                onClick={() => repor(folha.ocupante, folha.base)}
              >
                <CalendarClock className="h-4 w-4" /> Repor em outro dia
              </Button>
              <p className="px-1 text-xs text-slate-500">
                Repor é para quando não há mais vaga em base nenhuma: o plantão de hoje sai da conta sem virar falta, e o interno é avisado.
              </p>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" onClick={() => setFolha(null)}>Fechar</Button>
            </div>
          </div>
        </div>
      )}

      {parando && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-slate-950/45" onClick={() => setParando(null)} />
          <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <p className="text-sm font-medium text-red-700">Parar base neste turno</p>
            <h3 className="text-xl font-semibold text-slate-900">{parando.base.code} — {parando.base.name}</h3>
            <p className="mt-1 text-sm text-slate-500">
              Quem está lá continua visível; ninguém novo entra pela grade. Dá para reabrir a qualquer momento.
            </p>
            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Motivo (opcional)</span>
              <input
                value={parando.motivo}
                onChange={(e) => setParando({ ...parando, motivo: e.target.value })}
                placeholder="Ex.: sem médico confirmado, viatura na oficina"
                maxLength={300}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-accent-400 focus:bg-white"
              />
            </label>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setParando(null)} disabled={ocupado}>Cancelar</Button>
              <Button variant="destructive" onClick={pararBase} disabled={ocupado}>
                {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <PowerOff className="h-4 w-4" />} Parar a {parando.base.code}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
