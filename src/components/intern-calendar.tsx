"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { estiloDoTipo, nomeCurtoDaBase, rotuloDoTipo } from "@/lib/base-colors";
import { montarFita, type FaixaDaFita, type TurnoDaFita } from "@/lib/fita-turnos";
import { ORG } from "@/lib/instance";
import { cn, getShiftShortLabel, localDateStr } from "@/lib/utils";

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
};

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

// Diurno = papel claro e liso; noturno = tinta escura pontilhada. Valem nos
// dois lugares em que o turno aparece: a faixa da lista e o quadradinho da fita.
const PAPEL = "bg-[#FBF8F1] text-[#3E3626] shadow-[inset_0_0_0_1px_#EAE3D3]";
const TINTA = "bg-[#18203B] text-[#DCE2F5]";
const PONTILHADO: CSSProperties = {
  backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1.2px)",
  backgroundSize: "7px 7px",
};
// Descanso = pauta horizontal, para não confundir com hachura diagonal.
const PAUTA_DIA: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(0deg, rgba(128,128,128,0.22) 0 1px, transparent 1px 5px)",
};
const PAUTA_NOITE: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.09) 0 1px, transparent 1px 5px)",
};

function dataCurta(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.getUTCDate()} ${MES[d.getUTCMonth()]}`;
}

export function InternCalendar({ assignments, onDayPick }: Props) {
  const hoje = localDateStr();
  const semanas = useMemo(() => montarFita(assignments), [assignments]);
  const [mostrarPassadas, setMostrarPassadas] = useState(false);

  const porData = useMemo(() => {
    const map = new Map<string, CalendarAssignment[]>();
    for (const a of assignments) map.set(a.date, [...(map.get(a.date) ?? []), a]);
    return map;
  }, [assignments]);

  const tiposEmUso = useMemo(() => {
    const tipos = new Set(assignments.map((a) => a.baseType ?? "USA"));
    return (["USA", "CENTRAL", "CRL"] as const).filter((t) => tipos.has(t));
  }, [assignments]);

  const passadas = semanas.filter((s) => s.dias[6].date < hoje).length;
  const visiveis = mostrarPassadas ? semanas : semanas.slice(passadas);

  const abrirDia = (date: string) => {
    const items = porData.get(date);
    if (items?.length) onDayPick(date, items);
  };

  const irPara = (date: string) => {
    if (date < hoje && !mostrarPassadas) setMostrarPassadas(true);
    requestAnimationFrame(() =>
      document.getElementById(`fita-${date}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

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
              (["DAY", "NIGHT"] as const).map((turno) => (
                <CelulaDaFita
                  key={`${d.date}-${turno}`}
                  date={d.date}
                  turno={turno}
                  faixa={turno === "DAY" ? d.dia : d.noite}
                  hoje={hoje}
                  onClick={() => irPara(d.date)}
                />
              )),
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
        </div>
      </section>

      <div>
        <div className="sticky top-0 z-10 grid grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5 bg-background py-1.5">
          <span />
          <div className={cn("rounded-lg px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide", PAPEL)}>{CABECALHO.DAY}</div>
          <div className={cn("rounded-lg px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wide", TINTA)}>{CABECALHO.NIGHT}</div>
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
                    "grid min-h-16 scroll-mt-14 grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5",
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
                  <Faixa turno="DAY" faixa={d.dia} onClick={() => abrirDia(d.date)} />
                  <Faixa turno="NIGHT" faixa={d.noite} onClick={() => abrirDia(d.date)} />
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
  onClick,
}: {
  turno: TurnoDaFita;
  faixa: FaixaDaFita<CalendarAssignment>;
  onClick: () => void;
}) {
  const noite = turno === "NIGHT";

  if (faixa.plantoes.length === 0) {
    const pauta = faixa.descansoDe ? (noite ? PAUTA_NOITE : PAUTA_DIA) : undefined;
    return (
      <div
        className={cn("flex min-w-0 flex-col justify-center rounded-[10px] px-2.5 py-2", noite ? TINTA : PAPEL)}
        style={{ ...(noite && !pauta ? PONTILHADO : {}), ...pauta }}
      >
        {faixa.descansoDe && (
          <>
            <span className="truncate font-mono text-[10px] uppercase tracking-wide opacity-60">Descanso</span>
            <span className="truncate text-xs opacity-80">colado em {nomeCurtoDaBase(faixa.descansoDe.baseName)}</span>
          </>
        )}
      </div>
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
        return (
          <div
            key={a.id}
            className={cn(
              "flex min-h-16 w-full flex-1 flex-col justify-center gap-0.5 rounded-[10px] px-2.5 py-2",
              noite ? cn(TINTA, estilo.noite) : estilo.dia,
            )}
            style={noite ? PONTILHADO : undefined}
          >
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
    <span className={cn("self-start whitespace-nowrap rounded-full px-1.5 text-[10px] font-semibold leading-4", className)}>
      {children}
    </span>
  );
}

function CelulaDaFita({
  date,
  turno,
  faixa,
  hoje,
  onClick,
}: {
  date: string;
  turno: TurnoDaFita;
  faixa: FaixaDaFita<CalendarAssignment>;
  hoje: string;
  onClick: () => void;
}) {
  const noite = turno === "NIGHT";
  const plantao = faixa.plantoes[0];
  const style: CSSProperties | undefined = plantao
    ? noite ? { backgroundImage: "radial-gradient(rgba(0,0,0,0.35) 1px, transparent 1.2px)", backgroundSize: "4px 4px" } : undefined
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
        noite && "mr-0.5",
        date < hoje && "opacity-35",
        date === hoje && !noite && "after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded after:bg-accent-500",
      )}
      style={style}
    />
  );
}
