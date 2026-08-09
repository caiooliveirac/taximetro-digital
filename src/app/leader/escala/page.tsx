import { MontarEscala } from "@/components/scheduling/montar-escala";

/**
 * A tela é a mesma do `/admin/montar-escala`. Aqui, sem `facultyId`, a faculdade
 * vem do vínculo de quem está logado — o líder monta a escala da faculdade dele
 * e não tem o que escolher.
 */
export default function LeaderEscalaPage() {
  return <MontarEscala />;
}
