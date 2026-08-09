"use client";

/**
 * Montar Escala pela coordenação — a mesma tela do líder, sem impersonate.
 *
 * O líder tem faculdade no vínculo; o coordenador não tem nenhuma, então a
 * faculdade é a primeira decisão da tela e toda requisição carrega a escolhida.
 * Não há faculdade pré-selecionada quando existe mais de uma: montar a escala da
 * faculdade errada é caro de desfazer, e um clique é barato.
 */

import { useEffect, useState } from "react";
import { CalendarPlus, GraduationCap, Loader2, TriangleAlert } from "lucide-react";
import { MontarEscala } from "@/components/scheduling/montar-escala";

type Faculty = { id: string; abbreviation: string; name: string; isVirtual?: boolean };

export default function AdminMontarEscalaPage() {
  const [faculdades, setFaculdades] = useState<Faculty[]>([]);
  const [faculdadeId, setFaculdadeId] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/taximetro/api/admin/faculties", {
      cache: "no-store",
      headers: { "x-no-impersonate": "1" },
    })
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? "Não foi possível carregar as faculdades.");
        // Faculdade virtual não tem escala própria para montar.
        const reais = (json.data as Faculty[]).filter((f) => !f.isVirtual);
        setFaculdades(reais);
        // Com uma só, não há escolha a fazer.
        if (reais.length === 1) setFaculdadeId(reais[0].id);
      })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  const escolhida = faculdades.find((f) => f.id === faculdadeId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <CalendarPlus className="h-6 w-6 text-accent-500" strokeWidth={1.5} />
          Montar Escala
        </h1>
        <p className="text-sm text-slate-500">
          CRU fixo semanal e sorteio de intervenção nas bases USA — a mesma tela do líder, sem
          precisar entrar como ele. Escolha a faculdade e, no sorteio, a turma que participa.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="faculdade" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Faculdade
        </label>
        {carregando ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando faculdades...
          </p>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <select
              id="faculdade"
              value={faculdadeId}
              onChange={(e) => setFaculdadeId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 sm:w-96"
            >
              <option value="">Selecione a faculdade...</option>
              {faculdades.map((f) => (
                <option key={f.id} value={f.id}>{f.abbreviation} — {f.name}</option>
              ))}
            </select>
            {escolhida && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-700">
                <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.8} />
                Montando a escala de {escolhida.abbreviation}
              </span>
            )}
          </div>
        )}
        {erro && (
          <p className="mt-2 flex items-start gap-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {erro}
          </p>
        )}
      </div>

      {faculdadeId ? (
        /* key: trocar de faculdade recomeça a tela do zero, sem sobra da anterior
           (semana, seleção do sorteio, lista de internos). */
        <MontarEscala key={faculdadeId} facultyId={faculdadeId} />
      ) : (
        !carregando && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
            Escolha a faculdade para carregar a escala da semana.
          </p>
        )
      )}
    </div>
  );
}
