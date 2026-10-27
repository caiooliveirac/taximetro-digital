import { exigirFeature } from "@/lib/feature-gate";
import { VagasLivresConfig } from "@/components/admin/vagas-livres-config";

export const dynamic = "force-dynamic";

export default function AdminVagasLivres() {
  exigirFeature("liberacaoAutomatica");
  return <VagasLivresConfig />;
}
