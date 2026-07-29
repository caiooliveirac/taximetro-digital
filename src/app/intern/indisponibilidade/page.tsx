import { exigirFeature } from "@/lib/feature-gate";
import { InternUnavailabilityForm } from "@/components/intern/unavailability-form";

export default function InternIndisponibilidadePage() {
  // Bloqueio no servidor: numa instância sem a feature, a URL digitada dá 404.
  exigirFeature("internUnavailability");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Indisponibilidade</h1>
        <p className="text-sm text-slate-500">
          Avise em quais turnos você não pode pegar plantão. O sorteio da escala
          respeita o que estiver marcado aqui.
        </p>
      </div>
      <InternUnavailabilityForm />
    </div>
  );
}
