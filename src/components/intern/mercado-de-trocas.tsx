"use client";

import { useEffect, useMemo, useState } from "react";
import type { MercadoDeTrocas } from "@/features/requests/application/use-cases/get-swap-market";
import type { Caixa } from "@/shared/domain/policies/swap-match-policy";
import { estiloDoTipo, nomeCurtoDaBase, rotuloDoTipo } from "@/lib/base-colors";
import { cn, localDateStr } from "@/lib/utils";
import { PAPEL, PONTILHADO, TINTA } from "@/components/intern-calendar";

export type OfertaParaVoce = MercadoDeTrocas["paraVoce"][number];
export type ResumoDaMinhaOferta = MercadoDeTrocas["minhasOfertas"][number];

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const CAIXAS: { caixa: Exclude<Caixa, "FORA">; titulo: string; explica: string }[] = [
  { caixa: "PERFEITA", titulo: "Troca perfeita", explica: "Você marcou o turno da oferta, e quem ofertou marcou o turno do plantão que você dá." },
  { caixa: "COMBINA", titulo: "Combina com o que você marcou", explica: "Caem em turnos que você marcou Quero ou Posso. Quero vem primeiro." },
  { caixa: "PODE", titulo: "Você pode trocar", explica: "Você está livre e descansado no turno, e tem um plantão do mesmo tipo para dar." },
  { caixa: "SO_ENTREGANDO", titulo: "Só entregando o plantão colado", explica: "Colam num plantão seu: dá certo se a pessoa ficar justamente com ele." },
];

/** "qua 11/11 noite" */
export function turnoCurto(date: string, period: string) {
  const [, mes, dia] = date.slice(0, 10).split("-");
  return `${DIAS[new Date(`${date.slice(0, 10)}T12:00:00Z`).getUTCDay()]} ${dia}/${mes} ${period === "DAY" ? "dia" : "noite"}`;
}

function abertaHa(criadaEm: string) {
  const dias = Math.floor((Date.now() - new Date(criadaEm).getTime()) / 86_400_000);
  return dias <= 0 ? "ofertou hoje" : `aberta há ${dias} dia${dias > 1 ? "s" : ""}`;
}

/** Cartão de uma oferta no mercado: o turno como na fita, o lugar, quem, por quê. */
export function CartaoDaOferta({ oferta, children }: { oferta: OfertaParaVoce; children?: React.ReactNode }) {
  const noite = oferta.period === "NIGHT";
  const d = new Date(`${oferta.date}T12:00:00Z`);
  return (
    <article
      className={cn(
        "grid grid-cols-[56px_minmax(0,1fr)] gap-2.5 rounded-xl border bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]",
        oferta.caixa === "PERFEITA" ? "border-emerald-500 ring-1 ring-emerald-500" : "border-slate-200",
        oferta.caixa === "FORA" && "opacity-60",
      )}
    >
      <div
        className={cn("flex min-h-[60px] flex-col items-center justify-center rounded-lg px-1 py-1.5", noite ? TINTA : PAPEL)}
        style={noite ? PONTILHADO : undefined}
      >
        <span className="font-mono text-[10px] uppercase opacity-80">{DIAS[d.getUTCDay()]}</span>
        <b className="text-lg font-extrabold leading-none">{d.getUTCDate()}</b>
        <span className="font-mono text-[10px] uppercase opacity-80">{noite ? "noite" : "dia"}</span>
      </div>
      <div className="min-w-0">
        <p className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-slate-900">
          <i className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", estiloDoTipo(oferta.baseType).amostra)} />
          <span className="truncate">{nomeCurtoDaBase(oferta.baseName)}</span>
        </p>
        <p className="text-xs text-slate-500">
          {rotuloDoTipo(oferta.baseType)} · {oferta.quem}
          {oferta.facultyAbbr ? ` · ${oferta.facultyAbbr}` : ""} · {abertaHa(oferta.criadaEm)}
        </p>
        <p className="mt-1 text-[13px] text-slate-700">{oferta.motivo}</p>
        {children}
      </div>
    </article>
  );
}

/** Quem marcou o turno da minha oferta e quantos conseguem fechar a troca. */
export function ResumoDaOferta({ resumo, conversar }: {
  resumo: ResumoDaMinhaOferta;
  conversar: (internId: string, nome: string) => React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-lg bg-slate-50 p-2.5">
      <p className="text-xs text-slate-600">
        <b className="font-semibold tabular-nums text-slate-900">{resumo.podem}</b> colega{resumo.podem === 1 ? "" : "s"} pode{resumo.podem === 1 ? "" : "m"} fechar
        {" · "}
        <b className="font-semibold tabular-nums text-[#A16207]">{resumo.interessados.length}</b> marc{resumo.interessados.length === 1 ? "ou" : "aram"} este turno
      </p>
      {resumo.interessados.map((i) => (
        <div key={i.internId} className="flex items-center justify-between gap-2 border-t border-slate-200 pt-1.5">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-800">{i.nome}</p>
            <p className="text-[11px] text-slate-500">
              marcou {i.sinal === "QUERO" ? "Quero" : "Posso"}
              {i.perfeita ? " · troca perfeita: tem um plantão num turno que você marcou" : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", i.sinal === "QUERO" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800")}>
              {i.sinal === "QUERO" ? "Quero" : "Posso"}
            </span>
            {conversar(i.internId, i.nome)}
          </div>
        </div>
      ))}
      {resumo.interessados.length === 0 && (
        <p className="text-[11px] text-slate-500">Quem marcar Quero ou Posso neste turno vê sua oferta no topo.</p>
      )}
    </div>
  );
}

/** Oferta × procura por turno nas próximas 4 semanas. */
export function JanelaDeTrocas({ janela }: { janela: MercadoDeTrocas["janela"] }) {
  const hoje = localDateStr();
  const semanas = useMemo(() => {
    if (janela.length === 0) return [];
    const porTurno = new Map(janela.map((j) => [`${j.date}|${j.period}`, j]));
    const d0 = new Date(`${janela[0].date}T12:00:00Z`);
    const dow = d0.getUTCDay();
    d0.setUTCDate(d0.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    const fim = janela[janela.length - 1].date;
    const out: { inicio: string; dias: string[] }[] = [];
    for (const s = new Date(d0); s.toISOString().slice(0, 10) <= fim; s.setUTCDate(s.getUTCDate() + 7)) {
      const dias: string[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(s);
        d.setUTCDate(s.getUTCDate() + i);
        dias.push(d.toISOString().slice(0, 10));
      }
      out.push({ inicio: dias[0], dias });
    }
    return out.map((s) => ({ ...s, turnos: s.dias.flatMap((d) => (["DAY", "NIGHT"] as const).map((p) => ({ d, p, j: porTurno.get(`${d}|${p}`) }))) }));
  }, [janela]);

  const comMovimento = janela.filter((j) => j.ofertas || j.procura);
  const facil = [...comMovimento].filter((j) => j.procura > j.ofertas).sort((a, b) => (b.procura - b.ofertas) - (a.procura - a.ofertas)).slice(0, 3);
  const dificil = [...comMovimento].filter((j) => j.ofertas > j.procura).sort((a, b) => (b.ofertas - b.procura) - (a.ofertas - a.procura)).slice(0, 3);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-900">Janela de trocas <span className="font-normal text-slate-500">· próximas 4 semanas</span></h2>
      <p className="text-xs text-slate-500">
        Cada quadradinho é um turno. Verde: mais gente marcou Quero ou Posso do que há ofertas, plantão fácil de passar. Amarelo: sobram ofertas.
      </p>
      <div className="space-y-1 rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-[40px_repeat(14,minmax(0,1fr))] gap-0.5">
          <span />
          {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((d) => (
            <span key={d} className="col-span-2 text-center font-mono text-[10px] text-slate-400">{d}</span>
          ))}
        </div>
        {semanas.map((s) => (
          <div key={s.inicio} className="grid grid-cols-[40px_repeat(14,minmax(0,1fr))] items-center gap-0.5">
            <span className="font-mono text-[10px] text-slate-500">{Number(s.inicio.slice(8))}/{s.inicio.slice(5, 7)}</span>
            {s.turnos.map(({ d, p, j }) => {
              const saldo = j ? j.procura - j.ofertas : 0;
              const vazio = !j || (!j.ofertas && !j.procura);
              return (
                <span
                  key={`${d}-${p}`}
                  title={j ? `${turnoCurto(d, p)}: ${j.procura} marcaram, ${j.ofertas} oferta${j.ofertas === 1 ? "" : "s"}` : undefined}
                  className={cn(
                    "flex h-6 items-center justify-center rounded font-mono text-[10px] tabular-nums",
                    p === "NIGHT" && "mr-0.5 shadow-[inset_0_-3px_0_#18203B]",
                    !j || d < hoje ? "bg-transparent" : vazio ? "bg-slate-100 text-slate-400" : saldo > 0 ? (saldo >= 3 ? "bg-emerald-300 text-emerald-950" : "bg-emerald-100 text-emerald-900") : saldo < 0 ? (saldo <= -3 ? "bg-amber-300 text-amber-950" : "bg-amber-100 text-amber-900") : "bg-slate-100 text-slate-500",
                  )}
                >
                  {j && !vazio ? (saldo > 0 ? `+${saldo}` : saldo) : ""}
                </span>
              );
            })}
          </div>
        ))}
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-3.5 rounded-sm bg-emerald-300" />Mais gente querendo</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-3.5 rounded-sm bg-amber-300" />Mais ofertas</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-3.5 rounded-sm bg-slate-100 shadow-[inset_0_-3px_0_#18203B]" />Traço escuro = noite</span>
        </div>
        {(facil.length > 0 || dificil.length > 0) && (
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="rounded-lg bg-emerald-50 p-2">
              <p className="font-semibold text-emerald-900">Fácil de passar</p>
              {facil.length ? facil.map((j) => <p key={j.date + j.period} className="text-emerald-800">{turnoCurto(j.date, j.period)}</p>) : <p className="text-emerald-700/70">Ninguém marcou ainda.</p>}
            </div>
            <div className="rounded-lg bg-amber-50 p-2">
              <p className="font-semibold text-amber-900">Difícil de passar</p>
              {dificil.length ? dificil.map((j) => <p key={j.date + j.period} className="text-amber-800">{turnoCurto(j.date, j.period)}</p>) : <p className="text-amber-700/70">Nenhum turno sobrando.</p>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

type BaseDeAmbulancia = { id: string; code: string; name: string };

/**
 * Até 3 bases favoritas e 3 a evitar. Toque cicla: neutra → favorita → evitar
 * → neutra. Só reordena as ofertas dentro de cada caixa.
 */
export function BasesPreferidas({ onMudou }: { onMudou: () => void }) {
  const [bases, setBases] = useState<BaseDeAmbulancia[]>([]);
  const [pesos, setPesos] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/taximetro/api/intern/bases-preferidas")
      .then((r) => r.json())
      .then((json) => {
        if (!json?.success) return;
        setBases(json.data.bases);
        setPesos(Object.fromEntries(json.data.preferencias.map((p: { baseId: string; peso: number }) => [p.baseId, p.peso])));
      })
      .catch(() => {});
  }, []);

  const favoritas = bases.filter((b) => pesos[b.id] === 1);
  const evitar = bases.filter((b) => pesos[b.id] === -1);

  const tocar = async (base: BaseDeAmbulancia) => {
    const atual = pesos[base.id] ?? 0;
    const proximo = atual === 0 ? 1 : atual === 1 ? -1 : 0;
    if (proximo === 1 && favoritas.length >= 3) return setErro("No máximo 3 favoritas. Toque numa delas para tirar.");
    if (proximo === -1 && evitar.length >= 3) return setErro("No máximo 3 a evitar. Toque numa delas para tirar.");
    setErro(null);
    setPesos((p) => ({ ...p, [base.id]: proximo }));
    const r = await fetch("/taximetro/api/intern/bases-preferidas", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseId: base.id, peso: proximo }),
    }).then((x) => x.json()).catch(() => null);
    if (!r?.success) {
      setPesos((p) => ({ ...p, [base.id]: atual }));
      setErro(r?.error ?? "Não foi possível salvar. Tente de novo.");
      return;
    }
    onMudou();
  };

  if (bases.length === 0) return null;
  const nomes = (l: BaseDeAmbulancia[]) => l.map((b) => nomeCurtoDaBase(b.name)).join(", ");

  return (
    <details className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <summary className="cursor-pointer text-sm font-semibold text-slate-900">
        Suas bases
        <span className="ml-2 text-xs font-normal text-slate-500">
          {favoritas.length || evitar.length
            ? [favoritas.length ? `favoritas: ${nomes(favoritas)}` : "", evitar.length ? `evitar: ${nomes(evitar)}` : ""].filter(Boolean).join(" · ")
            : "escolha favoritas e a evitar"}
        </span>
      </summary>
      <p className="mt-2 text-xs text-slate-500">
        Toque numa base: uma vez marca favorita, duas marca evitar, três volta ao normal. Até 3 de cada.
        As ofertas das favoritas sobem dentro de cada caixa; as de evitar descem. Nada some.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {bases.map((b) => {
          const peso = pesos[b.id] ?? 0;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => tocar(b)}
              aria-pressed={peso !== 0}
              className={cn(
                "flex min-w-0 flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition",
                peso === 1 ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                  : peso === -1 ? "border-red-300 bg-red-50 text-red-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              )}
            >
              <span className="w-full truncate text-sm font-medium">{nomeCurtoDaBase(b.name)}</span>
              <span className="font-mono text-[10px] uppercase tracking-wide opacity-70">
                {peso === 1 ? "favorita" : peso === -1 ? "evitar" : b.code}
              </span>
            </button>
          );
        })}
      </div>
      {erro && <p className="mt-2 text-xs font-medium text-red-700">{erro}</p>}
    </details>
  );
}
