"use client";

import { useState } from "react";

/**
 * A grade de hoje para o interno que avisou um problema e procura vaga.
 *
 * Uma linha por base, na ordem canônica (SM01, CB02, PR03...), uma célula por
 * vaga da grade, todas do mesmo tamanho. O texto diz quem está lá ("Interno
 * EBMSP") ou "Livre"; a cor diz o que ele pode clicar: verde ocupa, vermelho
 * é interno com check-in feito, cinza é interno sem check-in dentro da
 * tolerância. A base irmã (mesmo endereço, outra viatura) vem sugerida no
 * topo. Base com aviso de problema ou desativada no `plantoes` mostra o motivo
 * e não oferece vaga.
 *
 * `useRemanejamento` segura os dados e as ações; quem renderiza decide quando
 * abrir — o aviso à coordenação abre a grade sozinho.
 */
type Celula =
  | { tipo: "livre" }
  | { tipo: "ocupada"; faculdade: string; estado: "sem-checkin" | "checkin-ok" | "saiu" | "remanejado"; reivindicavel: boolean };

type Base = {
  id: string;
  code: string;
  name: string;
  atual: boolean;
  irma: boolean;
  aviso: { tipo: string; hora: string } | null;
  desativada: { desde: string | null; motivo: string | null } | null;
  medicos: string[];
  celulas: Celula[];
};

type Grade = {
  aberta: boolean;
  abreAs: string;
  reivindicando: boolean;
  reivindicaAs: string;
  medicosDisponiveis: boolean;
  bases: Base[];
};

function ocupavel(c: Celula) {
  return c.tipo === "livre" || c.reivindicavel;
}

function temVaga(b: Base) {
  return !b.atual && b.celulas.some(ocupavel);
}

export function useRemanejamento(assignmentId: string) {
  const [grade, setGrade] = useState<Grade | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [indo, setIndo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/taximetro/api/intern/remanejamento?assignmentId=${assignmentId}`);
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
    const medico = base.medicos.length > 0 ? `\nMédico lá agora: ${base.medicos.join(", ")}.` : "";
    if (!window.confirm(`Ir para a ${base.code} — ${base.name}?${medico}\n\nA coordenação será avisada.`)) return;
    setIndo(base.id);
    setErro(null);
    try {
      const res = await fetch("/taximetro/api/intern/remanejamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

const CELULA = "w-full rounded-md border px-2 py-1.5 text-left text-xs leading-tight disabled:cursor-default";
const VERDE = "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
const VERMELHO = "border-red-200 bg-red-50 text-red-700";
const CINZA = "border-slate-200 bg-slate-50 text-slate-400";

function classeDaCelula(c: Celula, atual: boolean) {
  if (atual) return CINZA;
  if (ocupavel(c)) return VERDE;
  if (c.tipo === "ocupada" && c.estado === "checkin-ok") return VERMELHO;
  return CINZA;
}

function textoDaCelula(c: Celula) {
  if (c.tipo === "livre") return { titulo: "Livre", detalhe: "" };
  const detalhe = { "checkin-ok": "check-in ok", saiu: "já saiu", remanejado: "remanejado, a caminho", "sem-checkin": "sem check-in" }[c.estado];
  return { titulo: `Interno ${c.faculdade}`, detalhe };
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
          A partir das {grade.reivindicaAs}, interno sem check-in continua na grade, mas a vaga dele pode ser ocupada.
        </p>
      )}

      {grade?.aberta && irma && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs text-emerald-900">
            <span className="font-semibold">{irma.code}</span> é a mesma base física, outra viatura.
            {temVaga(irma) ? " Tem vaga: a troca natural." : irma.desativada ? " Está desativada." : irma.aviso ? " Também está com problema." : " Está sem vaga."}
          </p>
          {temVaga(irma) && (
            <button
              type="button"
              disabled={indo !== null}
              onClick={() => ir(irma)}
              className="shrink-0 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {indo === irma.id ? "Indo..." : `Ir para a ${irma.code}`}
            </button>
          )}
        </div>
      )}

      {grade?.aberta && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {grade.bases.map((b) => (
            <li key={b.id} className={`space-y-1.5 px-3 py-2 ${b.atual ? "bg-slate-50" : ""}`}>
              <p className="text-sm font-semibold text-slate-900">
                {b.code} <span className="font-normal text-slate-500">— {b.name}</span>
                {b.atual && <span className="ml-2 text-xs font-medium text-slate-400">você está aqui</span>}
                {b.irma && <span className="ml-2 text-xs font-medium text-emerald-700">mesma base física</span>}
              </p>
              {b.desativada && (
                <p className="text-xs font-medium text-red-700">
                  Desativada no plantões{b.desativada.desde ? ` desde ${b.desativada.desde}` : ""}
                  {b.desativada.motivo ? ` — ${b.desativada.motivo}` : ""}
                </p>
              )}
              {b.aviso && (
                <p className="text-xs font-medium text-amber-700">
                  Aviso às {b.aviso.hora}: {b.aviso.tipo}
                </p>
              )}
              {grade.medicosDisponiveis && (
                <p className="text-xs text-slate-500">
                  {b.medicos.length > 0 ? `Dr(a). ${b.medicos.join(", ")}` : "sem médico registrado"}
                </p>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {b.celulas.length === 0 && (
                  <span className="col-span-3 text-xs text-slate-400">
                    {b.desativada || b.aviso ? "sem vaga oferecida" : "sem grade neste turno"}
                  </span>
                )}
                {b.celulas.map((c, i) => {
                  const { titulo, detalhe } = textoDaCelula(c);
                  const clicavel = !b.atual && ocupavel(c);
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!clicavel || indo !== null}
                      onClick={() => ir(b)}
                      className={`${CELULA} ${classeDaCelula(c, b.atual)} ${clicavel ? "font-semibold" : "font-medium"}`}
                    >
                      <span className="block">{indo === b.id && clicavel ? "Indo..." : titulo}</span>
                      {detalhe && <span className="block text-[10px] opacity-80">{detalhe}</span>}
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
