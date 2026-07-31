"use client";

/**
 * Botão "Sortear escala" na tela do admin — exclusivo da instância Vitalmed.
 *
 * Fica num componente próprio, e não dentro de AdminFilledSchedule (1700+
 * linhas), para não tornar a tela do SAMU refém de uma funcionalidade que ela
 * não tem. A página só o renderiza quando a feature existe, e a rota de API
 * bloqueia por conta própria — esconder o botão nunca é a proteção.
 */

import { useCallback, useEffect, useState } from "react";
import { Dices, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

type Faculty = { id: string; abbreviation: string; name: string; isVirtual?: boolean };

type UserRow = {
  id: string;
  name: string;
  isActive: boolean;
  isArchived?: boolean;
  role: string | null;
  facultyId: string | null;
  allRoles?: Array<{ role: string; facultyId: string | null }>;
};

type Resultado = {
  total: number;
  internsAllocated: number;
  internsTotal: number;
  remainingPositions: number;
  numWeeks?: number;
  unallocatedInterns?: Array<{ internId: string; reasonLabel: string }>;
};

/** Segunda-feira da semana de hoje, no fuso local. */
function segundaDaSemana(): string {
  const hoje = new Date();
  hoje.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  const dia = String(hoje.getDate()).padStart(2, "0");
  return `${hoje.getFullYear()}-${mes}-${dia}`;
}

export function AdminLotteryButton({ onDone }: { onDone?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [faculdades, setFaculdades] = useState<Faculty[]>([]);
  const [internos, setInternos] = useState<UserRow[]>([]);
  const [faculdadeId, setFaculdadeId] = useState("");
  const [weekStart, setWeekStart] = useState(segundaDaSemana);
  const [maxShifts, setMaxShifts] = useState(1);
  const [numWeeks, setNumWeeks] = useState(1);
  const [carregando, setCarregando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    if (!aberto || faculdades.length > 0) return;
    setCarregando(true);
    setErro(null);
    Promise.all([
      fetch("/taximetro/api/admin/faculties", { cache: "no-store" }).then((r) => r.json()),
      fetch("/taximetro/api/admin/users", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([fac, usr]) => {
        if (!fac.success || !usr.success) throw new Error("Não foi possível carregar faculdades e internos.");
        setFaculdades((fac.data as Faculty[]).filter((f) => !f.isVirtual));
        setInternos(usr.data as UserRow[]);
      })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [aberto, faculdades.length]);

  /** Internos ativos da faculdade escolhida — são eles que entram no sorteio. */
  const elegiveis = internos.filter((u) => {
    if (!u.isActive || u.isArchived) return false;
    const papeis = u.allRoles ?? (u.role ? [{ role: u.role, facultyId: u.facultyId }] : []);
    return papeis.some((p) => p.role === "INTERN" && p.facultyId === faculdadeId);
  });

  const sortear = useCallback(async () => {
    setRodando(true);
    setErro(null);
    setResultado(null);
    try {
      const res = await fetch("/taximetro/api/admin/lottery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart,
          facultyId: faculdadeId,
          internIds: elegiveis.map((i) => i.id),
          maxShifts,
          numWeeks,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "O sorteio falhou.");
      setResultado(json.data as Resultado);
      onDone?.();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRodando(false);
    }
  }, [weekStart, faculdadeId, elegiveis, maxShifts, numWeeks, onDone]);

  if (!aberto) {
    return (
      <Button onClick={() => setAberto(true)} className="gap-1.5">
        <Dices className="h-4 w-4" strokeWidth={1.5} /> Sortear escala
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Sortear escala</h2>
        <button
          onClick={() => setAberto(false)}
          className="text-xs text-slate-500 underline underline-offset-2"
        >
          fechar
        </button>
      </div>

      {carregando ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando faculdades e internos...
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">
              Faculdade
              <select
                value={faculdadeId}
                onChange={(e) => setFaculdadeId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              >
                <option value="">Selecione...</option>
                {faculdades.map((f) => (
                  <option key={f.id} value={f.id}>{f.abbreviation} — {f.name}</option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-slate-600">
              Semana (segunda)
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>

            <label className="text-xs font-medium text-slate-600">
              Plantões por interno
              <input
                type="number"
                min={1}
                max={7}
                value={maxShifts}
                onChange={(e) => setMaxShifts(Math.min(7, Math.max(1, Number(e.target.value) || 1)))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>

            <label className="text-xs font-medium text-slate-600">
              Semanas
              <input
                type="number"
                min={1}
                max={8}
                value={numWeeks}
                onChange={(e) => setNumWeeks(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900"
              />
            </label>
          </div>

          <p className="text-xs text-slate-500">
            {faculdadeId
              ? `${elegiveis.length} interno(s) ativo(s) entram no sorteio. Quem declarou indisponibilidade não recebe plantão naquele turno.`
              : "Escolha a faculdade para ver quantos internos entram."}
          </p>

          <Button
            onClick={sortear}
            disabled={!faculdadeId || elegiveis.length === 0 || rodando}
            className="gap-1.5"
          >
            {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" strokeWidth={1.5} />}
            {rodando ? "Sorteando..." : "Sortear"}
          </Button>
        </>
      )}

      {erro && (
        <p className="flex items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {erro}
        </p>
      )}

      {resultado && (
        <div className="rounded-md bg-emerald-50 p-2 text-xs text-emerald-800">
          <p>
            {resultado.total} alocação(ões) criada(s)
            {(resultado.numWeeks ?? 1) > 1 ? ` (${resultado.numWeeks} semanas)` : ""} —{" "}
            {resultado.internsAllocated}/{resultado.internsTotal} internos alocados
            {resultado.remainingPositions > 0
              ? ` · ${resultado.remainingPositions} vaga(s) sem preencher`
              : " · sem vagas remanescentes"}
          </p>
          {(resultado.unallocatedInterns?.length ?? 0) > 0 && (
            <p className="mt-1 text-emerald-700">
              Não alocados:{" "}
              {resultado.unallocatedInterns!.slice(0, 5).map((item) => {
                const nome = internos.find((i) => i.id === item.internId)?.name ?? item.internId;
                return `${nome} (${item.reasonLabel})`;
              }).join(", ")}
              {resultado.unallocatedInterns!.length > 5 ? " ..." : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
