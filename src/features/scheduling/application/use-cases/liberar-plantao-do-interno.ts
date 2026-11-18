/**
 * O interno avisa que não vai poder ir e libera a vaga ele mesmo (decisão do
 * Caio, 18/11/2026). Antes, só o líder ou a coordenação tiravam alguém da
 * escala — 780 remoções em 30 dias, 300 delas a menos de 12h do turno.
 *
 * - Ele mesmo, com confirmação na Dai, até o início do turno.
 * - Não é falta: o plantão sai da escala dele e a casinha volta a ficar vazia.
 * - A vaga vira vaga livre para todas as faculdades, inclusive a dele: oferta
 *   em nome da faculdade dele com `autoRelease = "INTERNO"` (ver
 *   abertaTambemADona). Na repescagem segue o caminho de qualquer vaga livre.
 * - Plantão numa troca ou roda em andamento não se libera: a troca primeiro.
 * - Líder (mensagem da Dai) e coordenação (Telegram) ficam sabendo.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, extraShiftOffers, faculties, requests, swapCycleLegs, swapCycles, userRoles, users } from "@/db/schema";
import { hasShiftStarted } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import { avisarCoordenacaoNoTelegram } from "@/lib/telegram-coordenacao";
import { enviar } from "@/features/dai-avisos/remetente";
import { quando } from "@/lib/luna-inteligencia";
import { ORIGEM_INTERNO } from "@/features/scheduling/domain/policies/auto-release-policy";

const LIBERAVEL = ["SCHEDULED", "CONFIRMED"] as const;
const erro = (status: number, code: string, error: string) => ({ status, body: { success: false, code, error } }) as const;

export const notaDeLiberacao = (now: Date) => `Liberado pelo interno pela Dai em ${now.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}`;

export async function executeLiberarPlantao(p: { internId: string; assignmentId: string; now?: Date }) {
  const now = p.now ?? new Date();
  const [a] = await db
    .select({
      id: assignments.id, internId: assignments.internId, facultyId: assignments.facultyId, baseId: assignments.baseId,
      date: assignments.date, period: assignments.period, shift: assignments.shift, status: assignments.status,
      baseCode: bases.code, internName: users.name, facultyAbbr: faculties.abbreviation,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(eq(assignments.id, p.assignmentId))
    .limit(1);
  if (!a || a.internId !== p.internId) return erro(404, "NAO_ENCONTRADO", "Plantão não encontrado.");
  if (!(LIBERAVEL as readonly string[]).includes(a.status)) {
    return erro(409, "NAO_AGENDADO", "Esse plantão não está mais agendado: já começou, foi feito ou foi cancelado.");
  }
  const date = String(a.date).slice(0, 10);
  const period = a.period as "DAY" | "NIGHT";
  if (hasShiftStarted(date, period, a.shift, now)) {
    return erro(409, "TURNO_COMECOU", "O turno já começou: agora só o líder ou a coordenação mexem nele.");
  }

  const [troca] = await db.select({ id: requests.id }).from(requests)
    .where(and(inArray(requests.status, ["PENDING", "OPEN"]), or(eq(requests.assignmentId, a.id), eq(requests.targetAssignmentId, a.id))))
    .limit(1);
  const [roda] = await db.select({ id: swapCycles.id }).from(swapCycleLegs)
    .innerJoin(swapCycles, eq(swapCycles.id, swapCycleLegs.cycleId))
    .where(and(eq(swapCycles.status, "PROPOSTA"), or(eq(swapCycleLegs.givesAssignmentId, a.id), eq(swapCycleLegs.receivesAssignmentId, a.id))))
    .limit(1);
  if (troca || roda) {
    return erro(409, "EM_TROCA", "Esse plantão está numa troca em andamento. Cancele a troca em Trocas antes de liberar.");
  }

  const offerId = await db.transaction(async (tx) => {
    const [cancelado] = await tx.update(assignments)
      .set({ status: "CANCELLED", notes: notaDeLiberacao(now), updatedAt: now })
      .where(and(eq(assignments.id, a.id), inArray(assignments.status, [...LIBERAVEL])))
      .returning({ id: assignments.id });
    if (!cancelado) return null;
    const [oferta] = await tx.insert(extraShiftOffers).values({
      baseId: a.baseId, date, period, shift: a.shift,
      publishedBy: a.internId,
      releasedFacultyId: a.facultyId,
      autoRelease: ORIGEM_INTERNO,
      notes: `Liberada pelo interno (${a.facultyAbbr}): não vai poder ir`,
    }).returning({ id: extraShiftOffers.id });
    return oferta.id;
  });
  if (!offerId) return erro(409, "MUDOU", "O plantão mudou agora há pouco. Abra a Dai de novo e confira.");

  const turno = `${a.baseCode} ${quando(date, period, a.shift)}`;
  await logAudit({
    userId: a.internId,
    action: "INTERN_RELEASED_ASSIGNMENT",
    entity: "assignment",
    entityId: a.id,
    payload: { offerId, baseCode: a.baseCode, date, period, shift: a.shift, facultyAbbr: a.facultyAbbr },
  });

  // Avisos nunca derrubam a liberação: ela já aconteceu.
  const lideres = await db.selectDistinct({ id: users.id }).from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, "LEADER"), eq(userRoles.facultyId, a.facultyId), eq(userRoles.isActive, true), eq(userRoles.isArchived, false), eq(users.isActive, true)))
    .catch(() => []);
  await enviar(lideres.filter((l) => l.id !== a.internId).map((l) => ({
    para: l.id,
    texto: `🔓 ${a.internName} avisou que não vai poder ir e liberou o plantão **${turno}**.\nNão conta falta, mas a casinha dele voltou a ficar vazia. A vaga ficou livre para todas as faculdades, inclusive a sua: se quiser, escale alguém em Montar escala.`,
    action: "DAI_AVISO_LIBERACAO",
    entityId: l.id,
    payload: { assignmentId: a.id, offerId },
  })), false).catch(() => {});
  void avisarCoordenacaoNoTelegram(`🔓 Plantão liberado pelo interno\n${turno}\nInterno: ${a.internName} (${a.facultyAbbr})\nA vaga ficou livre para todas as faculdades.`);

  return {
    status: 200,
    body: {
      success: true,
      data: { offerId, texto: `Pronto: você saiu do **${turno}** e a vaga ficou livre para os colegas. Não conta falta, mas a casinha volta a ficar vazia na sua meta. Seu líder foi avisado.` },
    },
  } as const;
}
