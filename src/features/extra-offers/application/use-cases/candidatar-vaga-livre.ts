/**
 * Candidatura do interno a uma vaga livre (liberada por outra faculdade ou sem
 * dono): ele pede, a coordenação decide em Admin → Solicitações — o mesmo
 * pedido FREE_SLOT que o líder abre para interno acima da meta.
 *
 * Quem ainda tem casinha vazia no tipo não se candidata: o líder dele escala
 * direto na vaga, sem autorização. Quem já fechou a meta só se candidata
 * quando sobra vaga depois de quem precisa de reposição (fila-de-reposicao.ts).
 * Descanso de 12h sempre.
 */

import { db } from "@/shared/db/client";
import { eq } from "drizzle-orm";
import { bases, users } from "@/shared/db/schema";
import { getExtraOfferById } from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { findAssignmentByInternSlot } from "@/features/scheduling/infra/repositories/assignment-repository";
import { semDescansoPara } from "@/features/scheduling/application/descanso";
import { goalKindOf } from "@/lib/goal-slots";
import { hasShiftStarted } from "@/lib/utils";
import { candidaturaAberta, filaDeReposicao, textoDaFila } from "../fila-de-reposicao";
import { metaDoInternoNoTipo } from "./free-slot-goal";
import { pedirVagaLivre } from "./claim-extra-offer";

const erro = (status: number, code: string, error: string) => ({ status, body: { success: false, code, error } }) as const;

export async function executeCandidatarVagaLivre(params: {
  intern: { id: string; facultyId: string | null };
  offerId: string;
}) {
  const { intern, offerId } = params;
  if (!intern.facultyId) return erro(422, "SEM_FACULDADE", "Você não tem faculdade vinculada.");

  const offer = await getExtraOfferById(offerId);
  if (!offer) return erro(404, "NAO_ENCONTRADA", "Vaga não encontrada.");
  if (offer.cancelledAt || offer.claimedBy || offer.reservedBy) return erro(409, "JA_PEGA", "Essa vaga não está mais aberta.");
  const vagaLivre = Boolean(offer.releasedFacultyId) || offer.autoRelease === "SEM_DONO";
  if (!vagaLivre) return erro(400, "NAO_E_VAGA_LIVRE", "Isso é um extra comum: pegue direto na aba Extras.");
  if (offer.releasedFacultyId === intern.facultyId) return erro(409, "PROPRIA_FACULDADE", "Sua faculdade liberou esta vaga para as outras.");
  const period = offer.period as "DAY" | "NIGHT";
  if (hasShiftStarted(offer.date, period, offer.shift)) return erro(400, "JA_COMECOU", "Esse turno já começou.");

  const existente = await findAssignmentByInternSlot({ internId: intern.id, date: offer.date, period, shift: (offer.shift as "MORNING" | "AFTERNOON" | null) ?? null });
  if (existente && existente.status !== "CANCELLED") return erro(409, "JA_TEM_PLANTAO", "Você já tem plantão nesse dia e turno.");

  const [base] = await db.select({ code: bases.code, type: bases.type }).from(bases).where(eq(bases.id, offer.baseId)).limit(1);
  const semDescanso = await semDescansoPara(intern.id, "Você", { date: offer.date, period, shift: offer.shift, baseCode: base?.code ?? "" });
  if (semDescanso) return erro(409, "SEM_DESCANSO", semDescanso);

  const tipo = goalKindOf(base?.type);
  const meta = base ? await metaDoInternoNoTipo(intern.id, base.type) : null;
  if (!tipo || !meta) return erro(422, "SEM_META", "Não achei sua meta nesse tipo — fale com o líder.");
  if (!meta.cumprida) {
    return erro(409, "ABAIXO_DA_META", `Você ainda tem ${meta.missing} ${tipo} faltando: o líder da sua faculdade escala você nessa vaga direto, sem autorização. Peça a ele.`);
  }

  const fila = (await filaDeReposicao())[tipo];
  if (!candidaturaAberta(fila)) {
    return erro(409, "FILA_DE_REPOSICAO", `Candidatura fechada por enquanto: ${textoDaFila(tipo, fila)}. Abre quando sobrar vaga.`);
  }

  const [quem] = await db.select({ name: users.name }).from(users).where(eq(users.id, intern.id)).limit(1);
  return pedirVagaLivre({
    actor: { id: intern.id, role: "INTERN" },
    offer: { id: offer.id, baseId: offer.baseId, date: offer.date, period },
    internId: intern.id,
    internName: quem?.name ?? "interno",
    meta,
  });
}
