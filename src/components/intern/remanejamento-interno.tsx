"use client";

import { useState } from "react";

/**
 * Onde há vaga livre agora, para o interno que avisou um problema e procura
 * lugar.
 *
 * Só aparecem as bases com vaga que ele pode ocupar, na ordem canônica (SM01,
 * CB02, PR03...), uma célula verde por vaga. Quem está em cada base, com ou
 * sem check-in, e o médico presente não chegam aqui: são da coordenação, no
 * Plantão ao vivo (ver `vagasLivresDoInterno`). A base irmã (mesmo endereço,
 * outra viatura) vem sugerida no topo quando tem vaga.
 *
 * `useRemanejamento` segura os dados e as ações; quem renderiza decide quando
 * abrir — o aviso à coordenação abre a grade sozinho.
 */
type Vaga = { alemDaGrade: boolean };

type Base = {
  id: string;
  code: string;
  name: string;
  irma: boolean;
  vagas: Vaga[];
};

type Grade = {
  aberta: boolean;
  abreAs: string;
  reivindicando: boolean;
  reivindicaAs: string;
  bases: Base[];
};

export function useRemanejamento(assignmentId: string) {
  const [grade, setGrade] = useState<Grade | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [indo, setIndo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/taximetro/api/intern/remanejamento?assignmentId=${assignmentId}`, { headers: { "x-force-role": "INTERN" } });
      const json = await res.json();
      if (json.success) setGrade(json.data);
      else {
        setGrade(null);
        setErro(json.error ?? "Não foi possível carregar a grade.");
      }
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    }
    setCarregando(false);
  }

  async function ir(base: Base) {
    if (!window.confirm(`Ir para a ${base.code} — ${base.name}?\n\nA coordenação será avisada.`)) return;
    setIndo(base.id);
    setErro(null);
    try {
      const res = await fetch("/taximetro/api/intern/remanejamento", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-force-role": "INTERN" },
        body: JSON.stringify({ assignmentId, newBaseId: base.id }),
      });
      const json = await res.json();
      if (json.success) {
        window.alert(
          json.data.entregue
            ? `Você agora está na ${json.data.baseCode}. Coordenação avisada.`
            : `Você agora está na ${json.data.baseCode}. O aviso não chegou — ligue para a coordenação.`,
        );
        window.location.reload();
        return;
      }
      setErro(json.error ?? "Não foi possível remanejar.");
      await buscar();
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    }
    setIndo(null);
  }

  return { grade, carregando, indo, erro, buscar, ir };
}

const CELULA =
  "w-full rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-left text-xs font-semibold leading-tight text-emerald-800 hover:bg-emerald-100 disabled:cursor-default disabled:opacity-60";

function detalheDaVaga(v: Vaga, irma: boolean) {
  if (!v.alemDaGrade) return "";
  return irma ? "reserva sua, além da grade" : "além da grade";
}

export function GradeDeRemanejamento({ r }: { r: ReturnType<typeof useRemanejamento> }) {
  const { grade, indo, erro, ir } = r;
  const irma = grade?.bases.find((b) => b.irma) ?? null;

  return (
    <div className="space-y-2">
      {grade && !grade.aberta && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          A grade de vagas abre às {grade.abreAs}: tolerância para quem ainda vai chegar fazer o check-in na própria base.
        </p>
      )}

      {grade?.aberta && !grade.reivindicando && (
        <p className="text-xs text-slate-500">
          A partir das {grade.reivindicaAs} podem abrir mais vagas: a de quem não fez check-in. Atualize a grade.
        </p>
      )}

      {grade?.aberta && irma && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs text-emerald-900">
            <span className="font-semibold">{irma.code}</span> é a mesma base física, outra viatura. Tem vaga: a troca natural.
          </p>
          <button
            type="button"
            disabled={indo !== null}
            onClick={() => ir(irma)}
            className="shrink-0 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {indo === irma.id ? "Indo..." : `Ir para a ${irma.code}`}
          </button>
        </div>
      )}

      {grade?.aberta && grade.bases.length === 0 && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Nenhuma vaga livre em outra base agora. Atualize daqui a pouco ou ligue para a coordenação.
        </p>
      )}

      {grade?.aberta && grade.bases.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {grade.bases.map((b) => (
            <li key={b.id} className="space-y-1.5 px-3 py-2">
              <p className="text-sm font-semibold text-slate-900">
                {b.code} <span className="font-normal text-slate-500">— {b.name}</span>
                {b.irma && <span className="ml-2 text-xs font-medium text-emerald-700">mesma base física</span>}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {b.vagas.map((v, i) => {
                  const detalhe = detalheDaVaga(v, b.irma);
                  return (
                    <button key={i} type="button" disabled={indo !== null} onClick={() => ir(b)} className={CELULA}>
                      <span className="block">{indo === b.id ? "Indo..." : "Livre"}</span>
                      {detalhe && <span className="block text-[10px] font-medium opacity-80">{detalhe}</span>}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {erro && <p className="text-xs text-red-700">{erro}</p>}
    </div>
  );
}
