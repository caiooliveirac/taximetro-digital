"use client";

import { useState } from "react";

/**
 * Depois do aviso, o interno vê a grade de hoje inteira e se move sozinho.
 * Uma linha por base, na ordem canônica (SM01, CB02, PR03...), uma célula por
 * vaga: quem está lá com check-in feito em vermelho, quem ainda não chegou em
 * cor fraca, e a célula livre em verde — só ela tem clique. A base irmã (mesmo
 * endereço, outra viatura) vem sugerida no topo. Base com aviso de problema ou
 * desativada no `plantoes` mostra o motivo e não oferece célula livre.
 */
type Celula =
  | { tipo: "livre" }
  | { tipo: "ocupada"; faculdade: string; estado: "sem-checkin" | "checkin-ok" | "saiu" };

type Base = {
  id: string;
  code: string;
  name: string;
  atual: boolean;
  irma: boolean;
  aviso: { tipo: string; hora: string } | null;
  desativada: { desde: string; motivo: string | null } | null;
  medicos: string[];
  celulas: Celula[];
};

const ESTADO = {
  "sem-checkin": { rotulo: "sem check-in", classe: "border-slate-200 bg-slate-50 text-slate-400" },
  "checkin-ok": { rotulo: "check-in ok", classe: "border-red-200 bg-red-50 text-red-700" },
  saiu: { rotulo: "já saiu", classe: "border-slate-200 bg-slate-100 text-slate-500 line-through" },
} as const;

function temLivre(b: Base) {
  return b.celulas.some((c) => c.tipo === "livre");
}

export function RemanejamentoInterno({ assignmentId }: { assignmentId: string }) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [bases, setBases] = useState<Base[] | null>(null);
  const [medicosDisponiveis, setMedicosDisponiveis] = useState(false);
  const [indo, setIndo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function buscar() {
    setAberto(true);
    setCarregando(true);
    setMsg(null);
    try {
      const res = await fetch(`/taximetro/api/intern/remanejamento?assignmentId=${assignmentId}`);
      const json = await res.json();
      if (json.success) {
        setBases(json.data.bases);
        setMedicosDisponiveis(json.data.medicosDisponiveis);
      } else {
        setBases(null);
        setMsg({ ok: false, texto: json.error ?? "Não foi possível carregar a grade." });
      }
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão. Tente novamente." });
    }
    setCarregando(false);
  }

  async function ir(base: Base) {
    const medico = base.medicos.length > 0 ? `\nMédico lá agora: ${base.medicos.join(", ")}.` : "";
    if (!window.confirm(`Ir para a ${base.code} — ${base.name}?${medico}\n\nA coordenação será avisada.`)) return;
    setIndo(base.id);
    setMsg(null);
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
      setMsg({ ok: false, texto: json.error ?? "Não foi possível remanejar." });
      await buscar();
    } catch {
      setMsg({ ok: false, texto: "Erro de conexão. Tente novamente." });
    }
    setIndo(null);
  }

  const irma = bases?.find((b) => b.irma) ?? null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={buscar}
        disabled={carregando}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
      >
        {carregando ? "Carregando a grade..." : aberto && bases ? "Atualizar a grade" : "Ver vaga em outra base"}
      </button>

      {aberto && irma && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs text-emerald-900">
            <span className="font-semibold">{irma.code}</span> é a mesma base física, outra viatura.
            {temLivre(irma) ? " Tem vaga: a troca natural." : irma.desativada ? " Está desativada." : irma.aviso ? " Também está com problema." : " Está sem vaga."}
          </p>
          {temLivre(irma) && (
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

      {aberto && bases && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {bases.map((b) => (
            <li key={b.id} className={`space-y-1.5 px-3 py-2 ${b.atual ? "bg-slate-50" : ""}`}>
              <p className="text-sm font-semibold text-slate-900">
                {b.code} <span className="font-normal text-slate-500">— {b.name}</span>
                {b.atual && <span className="ml-2 text-xs font-medium text-slate-400">você está aqui</span>}
                {b.irma && <span className="ml-2 text-xs font-medium text-emerald-700">mesma base física</span>}
              </p>
              {b.desativada && (
                <p className="text-xs font-medium text-red-700">
                  Desativada no plantões desde {b.desativada.desde}
                  {b.desativada.motivo ? ` — ${b.desativada.motivo}` : ""}
                </p>
              )}
              {b.aviso && (
                <p className="text-xs font-medium text-amber-700">
                  Aviso às {b.aviso.hora}: {b.aviso.tipo}
                </p>
              )}
              {medicosDisponiveis && (
                <p className="text-xs text-slate-500">
                  {b.medicos.length > 0 ? `Dr(a). ${b.medicos.join(", ")}` : "sem médico registrado"}
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {b.celulas.length === 0 && (
                  <span className="text-xs text-slate-400">
                    {b.desativada || b.aviso ? "sem vaga oferecida" : "sem grade neste turno"}
                  </span>
                )}
                {b.celulas.map((c, i) =>
                  c.tipo === "livre" ? (
                    <button
                      key={i}
                      type="button"
                      disabled={b.atual || indo !== null}
                      onClick={() => ir(b)}
                      className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-default disabled:opacity-60"
                    >
                      {indo === b.id ? "Indo..." : "VAGA livre"}
                    </button>
                  ) : (
                    <span key={i} className={`rounded-md border px-2 py-1 text-xs font-medium ${ESTADO[c.estado].classe}`}>
                      VAGA {c.faculdade} · {ESTADO[c.estado].rotulo}
                    </span>
                  ),
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.texto}</p>}
    </div>
  );
}
