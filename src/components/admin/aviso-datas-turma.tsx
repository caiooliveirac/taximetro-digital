"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { dataDeLiberacao } from "@/features/scheduling/domain/policies/auto-release-policy";

/**
 * As datas da turma decidem quando a vaga não usada vira vaga livre para as
 * outras faculdades (auto-release-slots.ts). Quem cria ou edita a turma vê
 * isso na hora, com o prazo salvo da faculdade em Vagas livres.
 */

export type ConfigLiberacao = { facultyId: string; enabled: boolean; deadlineDays: number; enabledSince: string };

/** Prazo salvo por faculdade. Vazio na instância sem a feature (a rota dá 404). */
export function useConfigLiberacao() {
  const [configs, setConfigs] = useState<Map<string, ConfigLiberacao> | null>(null);
  useEffect(() => {
    fetch("/taximetro/api/admin/vagas-livres", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const lista: ConfigLiberacao[] = json?.success ? json.data.faculdades : [];
        setConfigs(new Map(lista.map((c) => [c.facultyId, c])));
      })
      .catch(() => setConfigs(new Map()));
  }, []);
  return configs;
}

function br(date: string) {
  return date.split("-").reverse().join("/");
}
function menosUmDia(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Frase do que as datas causam. null = nada a avisar (sem feature ou faculdade). */
export function resumoDatasDaTurma(cfg: ConfigLiberacao | undefined, startDate: string, endDate: string) {
  if (!cfg) return null;
  if (!cfg.enabled) return `Liberação automática desligada para esta faculdade: as vagas da grade ficam com ela de ${br(startDate)} a ${br(endDate)}.`;
  const libera = dataDeLiberacao({ cohortStart: startDate, enabledSince: cfg.enabledSince, deadlineDays: cfg.deadlineDays });
  return `A turma escala nas vagas da grade até ${br(menosUmDia(libera))}. A partir de ${br(libera)} e até ${br(endDate)}, a vaga que não tiver interno é liberada para os líderes das outras faculdades.`;
}

export function AvisoDatasTurma({ config, startDate, endDate }: { config: ConfigLiberacao | undefined; startDate?: string; endDate?: string }) {
  if (!startDate || !endDate) return null;
  if (endDate < startDate) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        O fim está antes do início.
      </p>
    );
  }
  const frase = resumoDatasDaTurma(config, startDate, endDate);
  if (!frase) return null;
  const dias = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000) + 1;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>
        <p className="font-semibold">Confira início e fim: {br(startDate)} a {br(endDate)} ({dias} dias).</p>
        <p className="mt-0.5">{frase}</p>
      </div>
    </div>
  );
}
