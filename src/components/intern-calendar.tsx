"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { estiloDoTipo, nomeCurtoDaBase, rotuloDoTipo } from "@/lib/base-colors";
import { montarFita, type FaixaDaFita, type TurnoDaFita } from "@/lib/fita-turnos";
import { ORG } from "@/lib/instance";
import { cn, getShiftShortLabel, localDateStr } from "@/lib/utils";
import { turnosColados } from "@/shared/domain/policies/rest-policy";
import {
  colisoesComOutroServico,
  motivoParaRecusarSinal,
  type SinalDoDia,
  type SinalMarcado,
} from "@/shared/domain/policies/day-signal-policy";

export type CalendarAssignment = {
  notes?: string | null;
  id: string;
  baseCode: string;
  baseName: string;
  baseType?: string | null;
  baseLatitude: number;
  baseLongitude: number;
  date: string;
  period: "DAY" | "NIGHT";
  shift?: string | null;
  status: string;
  isExtraShift?: boolean;
};

type Props = {
  assignments: CalendarAssignment[];
  onDayPick: (dateStr: string, dayAssignments: CalendarAssignment[]) => void;
  /** Sinais do interno. Sem `onMarcar`, o calendário só mostra plantões (Vitalmed). */
  sinais?: SinalMarcado[];
  /** Grava (ou apaga, com `null`) o sinal do turno. Devolve a mensagem de erro, se houver. */
  onMarcar?: (date: string, period: TurnoDaFita, signal: SinalDoDia | null, label?: string) => Promise<string | null>;
  /** Ofertas que cabem para o interno, por turno, e quantos colegas querem cada plantão dele. */
  mercado?: {
    paraVoce: { date: string; period: string; baseName: string; caixa: string }[];
    procuraNosMeusPlantoes: Record<string, number>;
  } | null;
  onAbrirTrocas?: () => void;
};

type Modo = "VER" | SinalDoDia;

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// No SAMU todo turno é 07–19 / 19–07. Na Vitalmed cada viatura tem seu horário
// (06–18, 08–20...), então o cabeçalho fica só com o nome do turno.
const CABECALHO = ORG === "samu"
  ? { DAY: "Diurno 07→19", NIGHT: "Noturno 19→07" }
  : { DAY: "Diurno", NIGHT: "Noturno" };

const STATUS_CURTO: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CHECKED_OUT: "Concluído",
  VALIDATED: "Concluído",
  APPROVED: "Concluído",
  EXCUSED: "Falta abonada",
};

const MODOS: { modo: Modo; rotulo: string; dica: string; amostra: string; amostraStyle?: CSSProperties }[] = [
  { modo: "VER", rotulo: "Ver", dica: "Toque num plantão para ver detalhes, fazer check-in ou ofertar para troca.", amostra: "bg-[linear-gradient(90deg,#FBF8F1_50%,#18203B_50%)] ring-1 ring-inset ring-slate-300" },
  { modo: "OUTRO_SERVICO", rotulo: "Outro serviço", dica: "Toque nos turnos em que você tem plantão fora do SAMU. Só você vê.", amostra: "ring-1 ring-inset ring-[#7C8396]", amostraStyle: { backgroundImage: "repeating-linear-gradient(135deg, #7C8396 0 2px, transparent 2px 5px)" } },
  { modo: "QUERO", rotulo: "Quero", dica: "Toque nos turnos em que você quer plantão. Toque de novo para desmarcar.", amostra: "ring-2 ring-inset ring-[#D9961A]" },
  { modo: "POSSO", rotulo: "Posso", dica: "Toque nos turnos em que você topa pegar plantão. Conta menos que Quero.", amostra: "ring-2 ring-inset ring-[#3D84EE]" },
];

// Diurno = papel claro e liso; noturno = tinta escura pontilhada. Valem nos
// dois lugares em que o turno aparece: a faixa da lista e o quadradinho da fita.
export const PAPEL = "bg-[#FBF8F1] text-[#3E3626] shadow-[inset_0_0_0_1px_#EAE3D3]";
export const TINTA = "bg-[#18203B] text-[#DCE2F5]";
export const PONTILHADO: CSSProperties = {
  backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1.2px)",
  backgroundSize: "7px 7px",
};
// Descanso = pauta horizontal, para não confundir com a hachura diagonal do outro serviço.
const PAUTA_DIA: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(0deg, rgba(128,128,128,0.22) 0 1px, transparent 1px 5px)",
};
const PAUTA_NOITE: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.09) 0 1px, transparent 1px 5px)",
};
const HACHURA: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, rgba(124,131,150,0.38) 0 3px, transparent 3px 9px)",
};
// Quero e Posso: contorno. Colisão: contorno vermelho por cima de tudo.
export const CONTORNO: Record<"QUERO" | "POSSO", string> = {
  QUERO: "shadow-[inset_0_0_0_2px_#D9961A]",
  POSSO: "shadow-[inset_0_0_0_2px_#3D84EE]",
};
const COLIDE = "ring-2 ring-[#E0434B] ring-offset-1 ring-offset-background";

const chave = (date: string, period: TurnoDaFita) => `${date}|${period}`;

function dataCurta(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCDate()} ${MES[d.getUTCMonth()]}`;
}

export function InternCalendar({ assignments, onDayPick, sinais = [], onMarcar, mercado, onAbrirTrocas }: Props) {
  const hoje = localDateStr();
  const semanas = useMemo(() => montarFita(assignments), [assignments]);
  const [mostrarPassadas, setMostrarPassadas] = useState(false);
  const [modo, setModo] = useState<Modo>("VER");
  const [rotuloOutro, setRotuloOutro] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const porData = useMemo(() => {
    const map = new Map<string, CalendarAssignment[]>();
    for (const a of assignments) map.set(a.date, [...(map.get(a.date) ?? []), a]);
    return map;
  }, [assignments]);

  const sinalPorTurno = useMemo(() => new Map(sinais.map((s) => [chave(s.date, s.period), s])), [sinais]);
  const colisoes = useMemo(() => colisoesComOutroServico(assignments, sinais), [assignments, sinais]);
  const outrosQueColidem = useMemo(
    () => new Set([...colisoes.values()].map((s) => chave(s.date, s.period))),
    [colisoes],
  );

  // Só as ofertas que dá para fechar: as fora do alcance não interessam no calendário.
  const ofertasPorTurno = useMemo(() => {
    const m = new Map<string, { baseName: string; caixa: string }[]>();
    for (const o of mercado?.paraVoce ?? []) {
      if (o.caixa === "FORA") continue;
      const k = chave(o.date, o.period as TurnoDaFita);
      m.set(k, [...(m.get(k) ?? []), o]);
    }
    return m;
  }, [mercado]);

  const tiposEmUso = useMemo(() => {
    const tipos = new Set(assignments.map((a) => a.baseType ?? "USA"));
    return (["USA", "CENTRAL", "CRL"] as const).filter((t) => tipos.has(t));
  }, [assignments]);

  const passadas = semanas.filter((s) => s.dias[6].date < hoje).length;
  const visiveis = mostrarPassadas ? semanas : semanas.slice(passadas);

  const avisar = (texto: string) => {
    setAviso(texto);
    window.setTimeout(() => setAviso((atual) => (atual === texto ? null : atual)), 4500);
  };

  const irPara = (date: string) => {
    if (date < hoje && !mostrarPassadas) setMostrarPassadas(true);
    requestAnimationFrame(() =>
      document.getElementById(`fita-${date}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const tocar = async (date: string, period: TurnoDaFita) => {
    const temPlantao = (porData.get(date) ?? []).some((a) => a.period === period);
    if (modo === "VER" || !onMarcar) {
      if (temPlantao) onDayPick(date, porData.get(date) ?? []);
      else if (ofertasPorTurno.get(chave(date, period))?.length) onAbrirTrocas?.();
      return;
    }
    if (date < hoje) return avisar("Esse dia já passou.");

    const atual = sinalPorTurno.get(chave(date, period));
    let novo: SinalDoDia | null;
    if (atual?.signal === modo) {
      novo = null;
    } else {
      if (modo !== "OUTRO_SERVICO") {
        const motivo = motivoParaRecusarSinal({ signal: modo, turno: { date, period }, plantoes: assignments, sinais });
        if (motivo) return avisar(motivo);
      }
      novo = modo;
    }
    const erro = await onMarcar(date, period, novo, novo === "OUTRO_SERVICO" ? rotuloOutro.trim() : undefined);
    if (erro) return avisar(erro);
    if (novo === "OUTRO_SERVICO") {
      const comPlantao = assignments.find((a) => {
        if (a.date === date && a.period === period) return true;
        return !a.shift && turnosColados({ date: a.date, period: a.period }).includes(chave(date, period));
      });
      if (comPlantao) avisar(`Colide com seu plantão de ${nomeCurtoDaBase(comPlantao.baseName)}. Para cumprir os dois, oferte esse plantão para troca.`);
    }
  };

  const faixaProps = (date: string, period: TurnoDaFita, faixa: FaixaDaFita<CalendarAssignment>) => {
    const sinal = sinalPorTurno.get(chave(date, period)) ?? null;
    // Turno vazio colado num outro serviço também fica sem descanso.
    const outroColado = faixa.plantoes.length === 0 && !faixa.descansoDe && !sinal
      ? turnosColados({ date, period }).map((k) => sinalPorTurno.get(k)).find((s) => s?.signal === "OUTRO_SERVICO") ?? null
      : null;
    return {
      turno: period,
      faixa,
      sinal,
      outroColado,
      colisoes,
      outroColide: sinal?.signal === "OUTRO_SERVICO" && outrosQueColidem.has(chave(date, period)),
      ofertas: sinal?.signal === "QUERO" || sinal?.signal === "POSSO" ? ofertasPorTurno.get(chave(date, period)) ?? [] : [],
      procura: mercado?.procuraNosMeusPlantoes[chave(date, period)] ?? 0,
      marcando: modo !== "VER" && date >= hoje,
      onClick: () => tocar(date, period),
    };
  };

  const dicaDoModo = MODOS.find((m) => m.modo === modo)!.dica;

  return (
    <div className="space-y-4">
      {/* Fita do rodízio: 14 turnos por semana, dia e noite alternados */}
      <section
        aria-label="Rodízio turno a turno"
        className="space-y-1.5 rounded-xl border border-slate-200/80 bg-white p-3 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      >
        <div className="grid grid-cols-[40px_repeat(14,minmax(0,1fr))] gap-0.5">
          <span />
          {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => (
            <span key={d} className="col-span-2 text-center font-mono text-[10px] text-slate-400">{d}</span>
          ))}
        </div>
        {semanas.map((s) => (
          <div key={s.inicio} className="grid grid-cols-[40px_repeat(14,minmax(0,1fr))] items-center gap-0.5">
            <span className="font-mono text-[10px] text-slate-500">{dataCurta(s.inicio)}</span>
            {s.dias.flatMap((d) =>
              (["DAY", "NIGHT"] as const).map((turno) => {
                const faixa = turno === "DAY" ? d.dia : d.noite;
                const sinal = sinalPorTurno.get(chave(d.date, turno)) ?? null;
                return (
                  <CelulaDaFita
                    key={`${d.date}-${turno}`}
                    date={d.date}
                    turno={turno}
                    faixa={faixa}
                    sinal={sinal}
                    colide={faixa.plantoes.some((a) => colisoes.has(a.id)) || (sinal?.signal === "OUTRO_SERVICO" && outrosQueColidem.has(chave(d.date, turno)))}
                    hoje={hoje}
                    onClick={() => irPara(d.date)}
                  />
                );
              }),
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
          {tiposEmUso.map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5">
              <i className={cn("inline-block h-2.5 w-3.5 rounded-sm", estiloDoTipo(t).amostra)} />
              {rotuloDoTipo(t)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-3.5 rounded-sm ring-1 ring-inset ring-slate-200" style={PAUTA_DIA} />
            Descanso 12h
          </span>
          {onMarcar && (
            <>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-3.5 rounded-sm ring-1 ring-inset ring-[#7C8396]" style={HACHURA} />
                Outro serviço
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className={cn("inline-block h-2.5 w-3.5 rounded-sm", CONTORNO.QUERO)} />
                Quero
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className={cn("inline-block h-2.5 w-3.5 rounded-sm", CONTORNO.POSSO)} />
                Posso
              </span>
            </>
          )}
        </div>
      </section>

      <div>
        <div className="sticky top-0 z-10 space-y-1.5 bg-background py-1.5">
          {onMarcar && (
            <>
              <div role="group" aria-label="Modo do calendário" className="grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-white p-1">
                {MODOS.map((m) => (
                  <button
                    key={m.modo}
                    type="button"
                    aria-pressed={modo === m.modo}
                    onClick={() => setModo(m.modo)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-xs font-medium leading-tight transition",
                      modo === m.modo ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-50",
                    )}
                  >
                    <i className={cn("block h-2 w-5 rounded-[3px]", m.amostra)} style={m.amostraStyle} />
                    {m.rotulo}
                  </button>
                ))}
              </div>
              {modo === "OUTRO_SERVICO" && (
                <input
                  id="rotulo-outro-servico"
                  value={rotuloOutro}
                  onChange={(e) => setRotuloOutro(e.target.value.slice(0, 60))}
                  placeholder="Onde? Ex.: UPA, HGE (opcional)"
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
                />
              )}
              <p
                aria-live="polite"
                className={cn("min-h-5 text-xs", aviso ? "font-medium text-[#B42318]" : "text-slate-500")}
              >
                {aviso ?? dicaDoModo}
              </p>
            </>
          )}
          <div className="grid grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
            <span />
            <div className={cn("rounded-lg px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide", PAPEL)}>{CABECALHO.DAY}</div>
            <div className={cn("rounded-lg px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide", TINTA)}>{CABECALHO.NIGHT}</div>
          </div>
        </div>

        {passadas > 0 && (
          <button
            type="button"
            onClick={() => setMostrarPassadas((v) => !v)}
            className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 transition hover:bg-white"
          >
            {mostrarPassadas
              ? "Esconder semanas anteriores"
              : `Mostrar ${passadas} semana${passadas > 1 ? "s" : ""} anterior${passadas > 1 ? "es" : ""}`}
          </button>
        )}

        {visiveis.map((s) => (
          <section key={s.inicio} className="space-y-1">
            <h3 className="mb-1 mt-4 text-sm font-semibold text-slate-500">
              {dataCurta(s.inicio)} – {dataCurta(s.dias[6].date)}
            </h3>
            {s.dias.map((d) => {
              const dt = new Date(`${d.date}T12:00:00Z`);
              const ehHoje = d.date === hoje;
              return (
                <div
                  key={d.date}
                  id={`fita-${d.date}`}
                  className={cn(
                    "grid min-h-16 scroll-mt-40 grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5",
                    d.date < hoje && "opacity-45",
                  )}
                >
                  <div className="flex flex-col justify-center pl-0.5">
                    <span className={cn("font-mono text-[11px] uppercase tracking-wide", ehHoje ? "text-accent-500" : "text-slate-500")}>
                      {DIA_SEMANA[dt.getUTCDay()]}{ehHoje && " · hoje"}
                    </span>
                    <span className={cn("text-2xl font-extrabold leading-none tabular-nums", ehHoje ? "text-accent-500" : "text-slate-900")}>
                      {dt.getUTCDate()}
                    </span>
                  </div>
                  <Faixa {...faixaProps(d.date, "DAY", d.dia)} />
                  <Faixa {...faixaProps(d.date, "NIGHT", d.noite)} />
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function Faixa({
  turno,
  faixa,
  sinal,
  outroColado,
  colisoes,
  outroColide,
  ofertas,
  procura,
  marcando,
  onClick,
}: {
  turno: TurnoDaFita;
  faixa: FaixaDaFita<CalendarAssignment>;
  sinal: SinalMarcado | null;
  outroColado: SinalMarcado | null;
  colisoes: Map<string, SinalMarcado>;
  outroColide: boolean;
  ofertas: { baseName: string; caixa: string }[];
  procura: number;
  marcando: boolean;
  onClick: () => void;
}) {
  const noite = turno === "NIGHT";

  if (faixa.plantoes.length === 0) {
    const ehOutro = sinal?.signal === "OUTRO_SERVICO";
    const ehInteresse = sinal?.signal === "QUERO" || sinal?.signal === "POSSO";
    const emDescanso = !sinal && (faixa.descansoDe || outroColado);
    const fundo: CSSProperties = ehOutro
      ? HACHURA
      : emDescanso
        ? noite ? PAUTA_NOITE : PAUTA_DIA
        : noite ? PONTILHADO : {};
    const conteudo = (
      <>
        {ehOutro && outroColide && <Etiqueta className="bg-[#E0434B] text-white">colide</Etiqueta>}
        {ehOutro && (
          <>
            <span className="truncate text-[15px] font-semibold leading-tight">{sinal.label || "Outro serviço"}</span>
            <span className="truncate font-mono text-[10px] uppercase tracking-wide opacity-70">Outro serviço</span>
          </>
        )}
        {ehInteresse && ofertas.some((o) => o.caixa === "PERFEITA") && (
          <Etiqueta className="bg-emerald-600 text-white">troca perfeita</Etiqueta>
        )}
        {ehInteresse && ofertas.length > 0 && !ofertas.some((o) => o.caixa === "PERFEITA") && (
          <Etiqueta className="bg-[#D9961A] text-[#2A1A00]">{`${ofertas.length} oferta${ofertas.length > 1 ? "s" : ""}`}</Etiqueta>
        )}
        {ehInteresse && (
          <span className={cn("truncate font-mono text-[10px] font-semibold uppercase tracking-wide", sinal.signal === "QUERO" ? (noite ? "text-[#F5C46A]" : "text-[#A16207]") : noite ? "text-[#8DB8FF]" : "text-[#1D4ED8]")}>
            {sinal.signal === "QUERO" ? "Quero plantão" : "Posso pegar"}
          </span>
        )}
        {ehInteresse && ofertas.length > 0 && (
          <span className="truncate text-[13px] font-semibold leading-tight">
            {ofertas.map((o) => nomeCurtoDaBase(o.baseName)).join(" · ")}
          </span>
        )}
        {emDescanso && (
          <>
            <span className="truncate font-mono text-[10px] uppercase tracking-wide opacity-60">Descanso</span>
            <span className="truncate text-xs opacity-80">
              colado em {faixa.descansoDe ? nomeCurtoDaBase(faixa.descansoDe.baseName) : outroColado?.label || "outro serviço"}
            </span>
          </>
        )}
        {!sinal && !emDescanso && marcando && <span className="text-[11px] opacity-50">toque para marcar</span>}
      </>
    );
    const classe = cn(
      "flex min-h-16 min-w-0 flex-col justify-center gap-0.5 rounded-[10px] px-2.5 py-2 text-left",
      noite ? TINTA : PAPEL,
      ehInteresse && CONTORNO[sinal.signal as "QUERO" | "POSSO"],
      outroColide && COLIDE,
    );
    if (!marcando && !(ehInteresse && ofertas.length > 0)) return <div className={classe} style={fundo}>{conteudo}</div>;
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(classe, "outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent-500/60")}
        style={fundo}
      >
        {conteudo}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-col gap-1 rounded-[10px] text-left outline-none transition active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent-500/60"
    >
      {faixa.plantoes.map((a) => {
        const estilo = estiloDoTipo(a.baseType);
        const tipo = rotuloDoTipo(a.baseType);
        const meioTurno = a.shift ? getShiftShortLabel(a.shift) : null;
        const colisao = colisoes.get(a.id);
        return (
          <div
            key={a.id}
            className={cn(
              "flex min-h-16 w-full flex-1 flex-col justify-center gap-0.5 rounded-[10px] px-2.5 py-2",
              noite ? cn(TINTA, estilo.noite) : estilo.dia,
              colisao && COLIDE,
            )}
            style={noite ? PONTILHADO : undefined}
          >
            {colisao && (
              <Etiqueta className="bg-[#E0434B] text-white">
                {`colide${colisao.label ? ` · ${colisao.label}` : ""}`}
              </Etiqueta>
            )}
            {procura > 0 && !colisao && (
              <Etiqueta className="bg-[#D9961A] text-[#2A1A00]">{`${procura} ${procura > 1 ? "querem" : "quer"} este turno`}</Etiqueta>
            )}
            {a.status === "ABSENT" && <Etiqueta className="bg-red-500 text-white">Ausente</Etiqueta>}
            {a.status === "CHECKED_IN" && <Etiqueta className="bg-amber-400 text-amber-950">Em andamento</Etiqueta>}
            <span className="truncate text-[15px] font-semibold leading-tight">{nomeCurtoDaBase(a.baseName)}</span>
            <span className="truncate font-mono text-[10px] uppercase tracking-wide opacity-85">
              {[tipo, meioTurno, a.isExtraShift ? "Extra" : null, STATUS_CURTO[a.status]].filter(Boolean).join(" · ")}
            </span>
          </div>
        );
      })}
    </button>
  );
}

function Etiqueta({ className, children }: { className: string; children: string }) {
  return (
    <span className={cn("max-w-full self-start truncate whitespace-nowrap rounded-full px-1.5 text-[10px] font-semibold leading-4", className)}>
      {children}
    </span>
  );
}

function CelulaDaFita({
  date,
  turno,
  faixa,
  sinal,
  colide,
  hoje,
  onClick,
}: {
  date: string;
  turno: TurnoDaFita;
  faixa: FaixaDaFita<CalendarAssignment>;
  sinal: SinalMarcado | null;
  colide: boolean;
  hoje: string;
  onClick: () => void;
}) {
  const noite = turno === "NIGHT";
  const plantao = faixa.plantoes[0];
  const style: CSSProperties | undefined = plantao
    ? noite ? { backgroundImage: "radial-gradient(rgba(0,0,0,0.35) 1px, transparent 1.2px)", backgroundSize: "4px 4px" } : undefined
    : sinal?.signal === "OUTRO_SERVICO"
      ? HACHURA
      : faixa.descansoDe
        ? noite ? PAUTA_NOITE : PAUTA_DIA
        : noite ? PONTILHADO : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${dataCurta(date)}, ${noite ? "noturno" : "diurno"}${plantao ? `: ${nomeCurtoDaBase(plantao.baseName)}` : ""}`}
      className={cn(
        "relative h-5 rounded-[3px]",
        plantao ? estiloDoTipo(plantao.baseType).amostra : noite ? TINTA : PAPEL,
        !plantao && (sinal?.signal === "QUERO" || sinal?.signal === "POSSO") && CONTORNO[sinal.signal],
        colide && "outline outline-2 -outline-offset-1 outline-[#E0434B]",
        noite && "mr-0.5",
        date < hoje && "opacity-35",
        date === hoje && !noite && "after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded after:bg-accent-500",
      )}
      style={style}
    />
  );
}
