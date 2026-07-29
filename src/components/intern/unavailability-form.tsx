"use client";

/**
 * O interno declara os turnos em que não pode pegar plantão (Vitalmed).
 *
 * A grade é semana × turno (dia/noite). Cada célula é um botão que cicla entre
 * livre e os motivos disponíveis. O teto por motivo aparece na tela — a ideia é
 * o interno entender o limite antes de esbarrar nele, e não descobrir por erro
 * depois de montar a semana inteira.
 *
 * A validação da tela é conveniência; quem manda é o servidor
 * (unavailability-policy.ts), que revalida o conjunto inteiro.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Check, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MOTIVOS_INDISPONIBILIDADE,
  ROTULO_MOTIVO,
  TETO_POR_MOTIVO,
  TETO_TOTAL,
  datasDaSemana,
  saldoPorMotivo,
  validarSemana,
  type MotivoIndisponibilidade,
  type Indisponibilidade,
} from "@/shared/domain/policies/unavailability-policy";

const PERIODOS = [
  { valor: "DAY" as const, rotulo: "Dia" },
  { valor: "NIGHT" as const, rotulo: "Noite" },
];

const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Cores por motivo — o mesmo motivo tem sempre a mesma cor na grade. */
const COR_MOTIVO: Record<MotivoIndisponibilidade, string> = {
  CRU_SAMU: "bg-sky-100 text-sky-800 border-sky-300",
  USA_SAMU: "bg-amber-100 text-amber-800 border-amber-300",
  AULA: "bg-violet-100 text-violet-800 border-violet-300",
};

const CICLO: Array<MotivoIndisponibilidade | null> = [null, ...MOTIVOS_INDISPONIBILIDADE];

function segundaDaSemana(): string {
  const hoje = new Date();
  hoje.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");
  return `${hoje.getFullYear()}-${mes}-${dia}`;
}

function formatarDia(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

export function InternUnavailabilityForm() {
  const [weekStart, setWeekStart] = useState(segundaDaSemana);
  const [marcados, setMarcados] = useState<Map<string, MotivoIndisponibilidade>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const datas = useMemo(() => datasDaSemana(weekStart), [weekStart]);

  const itens: Indisponibilidade[] = useMemo(
    () =>
      [...marcados.entries()].map(([chave, reason]) => {
        const [date, period] = chave.split("|");
        return { date, period: period as "DAY" | "NIGHT", reason };
      }),
    [marcados],
  );

  const saldo = useMemo(() => saldoPorMotivo(itens), [itens]);
  const validacao = useMemo(() => validarSemana(itens), [itens]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(
        `/taximetro/api/intern/unavailability?weekStart=${weekStart}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Não foi possível carregar.");
      const mapa = new Map<string, MotivoIndisponibilidade>();
      for (const item of json.data.itens as Indisponibilidade[]) {
        mapa.set(`${item.date}|${item.period}`, item.reason);
      }
      setMarcados(mapa);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, [weekStart]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const cicla = useCallback((date: string, period: "DAY" | "NIGHT") => {
    setSalvo(false);
    setMarcados((anterior) => {
      const chave = `${date}|${period}`;
      const atual = anterior.get(chave) ?? null;
      const proximo = CICLO[(CICLO.indexOf(atual) + 1) % CICLO.length];
      const copia = new Map(anterior);
      if (proximo === null) copia.delete(chave);
      else copia.set(chave, proximo);
      return copia;
    });
  }, []);

  const salvar = useCallback(async () => {
    setSalvando(true);
    setErro(null);
    setSalvo(false);
    try {
      const res = await fetch("/taximetro/api/intern/unavailability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, itens }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Não foi possível salvar.");
      setSalvo(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }, [weekStart, itens]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">
          Semana (segunda)
          <input
            type="date"
            value={weekStart}
            onChange={(e) => setWeekStart(e.target.value)}
            className="mt-1 block rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
          />
        </label>
        <p className="text-xs text-slate-500">
          {itens.length} de {TETO_TOTAL} turnos marcados
        </p>
      </div>

      {/* Saldo por motivo: o teto é por motivo, então mostrar só o total esconde
          metade da regra. */}
      <div className="flex flex-wrap gap-2">
        {MOTIVOS_INDISPONIBILIDADE.map((motivo) => (
          <span
            key={motivo}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${COR_MOTIVO[motivo]}`}
          >
            {ROTULO_MOTIVO[motivo]}: {TETO_POR_MOTIVO[motivo] - saldo[motivo]}/{TETO_POR_MOTIVO[motivo]}
          </span>
        ))}
      </div>

      <p className="text-xs text-slate-500">
        Toque numa célula para alternar entre livre → CRU SAMU → USA SAMU → Aula → livre.
      </p>

      {carregando ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando sua semana...
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-xs font-medium text-slate-500">Turno</th>
                {datas.map((data, i) => (
                  <th key={data} className="p-1.5 text-center text-xs font-medium text-slate-600">
                    {DIAS[i]}<br />
                    <span className="font-normal text-slate-400">{formatarDia(data)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERIODOS.map((periodo) => (
                <tr key={periodo.valor}>
                  <td className="p-1.5 text-xs font-medium text-slate-600">{periodo.rotulo}</td>
                  {datas.map((data) => {
                    const motivo = marcados.get(`${data}|${periodo.valor}`);
                    return (
                      <td key={data} className="p-1">
                        <button
                          type="button"
                          onClick={() => cicla(data, periodo.valor)}
                          aria-label={`${periodo.rotulo} de ${formatarDia(data)}: ${motivo ? ROTULO_MOTIVO[motivo] : "disponível"}`}
                          className={`h-11 w-full rounded-md border text-[10px] font-semibold leading-tight transition ${
                            motivo
                              ? COR_MOTIVO[motivo]
                              : "border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100"
                          }`}
                        >
                          {motivo ? ROTULO_MOTIVO[motivo] : "livre"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!validacao.ok && (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {validacao.motivo}
        </p>
      )}

      {erro && (
        <p className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {erro}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={salvar} disabled={salvando || carregando || !validacao.ok}>
          {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          {salvando ? "Salvando..." : "Salvar semana"}
        </Button>
        {salvo && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" /> Semana salva
          </span>
        )}
      </div>
    </div>
  );
}
