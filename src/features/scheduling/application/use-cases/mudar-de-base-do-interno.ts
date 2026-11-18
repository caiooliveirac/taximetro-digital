/**
 * O interno muda de base num plantão que ainda não começou, sozinho e sem
 * aprovação (decisão do Caio, 18/11/2026; docs/PLAN-dai-remanejar.md, fase 3).
 * "Quero ir para a PM40 dia 25."
 *
 * É a liberação (liberar-plantao-do-interno.ts) mais a pegada de uma vaga
 * livre, num passo só, numa transação:
 * - a vaga livre de destino fica com ele (claimedBy / assignmentId);
 * - o plantão dele muda de base, com a nota [MUDOU DE BASE] (não é
 *   [REMANEJADO]: esse conta como presente no dia);
 * - o lugar que ele deixou vira vaga livre para todas as faculdades, como na
 *   liberação (`autoRelease = "INTERNO"`).
 *
 * Só para vaga livre do mesmo dia, turno e tipo (USA por USA): a casinha da
 * meta não muda e o descanso de 12h não muda. Vaga liberada pelo líder da
 * própria faculdade continua só para as outras (abertaTambemADona); vaga já na
 * janela da repescagem vai a sorteio, não se pega; a base de destino precisa
 * caber mais um (soAsQueCabem). Coordenação (Telegram) e líder (Dai) ficam
 * sabendo.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, extraShiftOffers, faculties, users } from "@/db/schema";
import { hasShiftStarted } from "@/lib/utils";
import { goalKindOf } from "@/lib/goal-slots";
import { logAudit } from "@/shared/infra/logger/audit";
import { avisarCoordenacaoNoTelegram } from "@/lib/telegram-coordenacao";
import { quando } from "@/lib/luna-inteligencia";
import { avisarLideres } from "@/lib/remanejamento-grade";
import { abertaTambemADona, ORIGEM_INTERNO } from "@/features/scheduling/domain/policies/auto-release-policy";
import { naRepescagem } from "@/features/extra-offers/application/repescagem";
import { soAsQueCabem } from "@/features/extra-offers/application/lotacao";
import { emTroca } from "./liberar-plantao-do-interno";

const AGENDADO = ["SCHEDULED", "CONFIRMED"] as const;
const erro = (status: number, code: string, error: string) => ({ status, body: { success: false, code, error } }) as const;

export const notaDeMudanca = (de: string, para: string, now: Date) =>
  `[MUDOU DE BASE] ${de} -> ${para} pelo interno pela Dai em ${now.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}`;

/** Pura, para teste: por que essa vaga não serve para trocar por este plantão (null = serve). */
export function motivoParaNaoMudar(
  a: { baseId: string; facultyId: string; date: string; period: string; tipo: string | null },
  o: { baseId: string; date: string; period: string; tipo: string | null; releasedFacultyId: string | null; autoRelease: string | null },
): string | null {
  if (o.date !== a.date || o.period !== a.period) return "Essa vaga é de outro dia ou turno: a troca de base é no mesmo turno do seu plantão.";
  if (o.baseId === a.baseId) return "Essa vaga é na mesma base do seu plantão.";
  if (o.tipo !== a.tipo) return "Essa vaga é de outro tipo: a troca de base é USA por USA, para a meta não mudar.";
  if (!o.releasedFacultyId && o.autoRelease !== "SEM_DONO") return "Essa vaga é um extra: pega-se na aba Extras.";
  if (o.releasedFacultyId === a.facultyId && !abertaTambemADona(o.autoRelease)) return "Essa vaga foi liberada pela sua faculdade para as outras.";
  return null;
}

export async function executeMudarDeBase(p: { internId: string; assignmentId: string; offerId: string; now?: Date }) {
  const now = p.now ?? new Date();
  const [a] = await db
    .select({
      id: assignments.id, internId: assignments.internId, facultyId: assignments.facultyId, baseId: assignments.baseId,
      date: assignments.date, period: assignments.period, shift: assignments.shift, status: assignments.status, notes: assignments.notes,
      baseCode: bases.code, baseType: bases.type, internName: users.name, facultyAbbr: faculties.abbreviation,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(eq(assignments.id, p.assignmentId))
    .limit(1);
  if (!a || a.internId !== p.internId) return erro(404, "NAO_ENCONTRADO", "Plantão não encontrado.");
  if (!(AGENDADO as readonly string[]).includes(a.status)) {
    return erro(409, "NAO_AGENDADO", "Esse plantão não está mais agendado: já começou, foi feito ou foi cancelado.");
  }
  const date = String(a.date).slice(0, 10);
  const period = a.period as "DAY" | "NIGHT";
  if (hasShiftStarted(date, period, a.shift, now)) {
    return erro(409, "TURNO_COMECOU", "O turno já começou: aí é o remanejamento, pelo card do plantão na aba Hoje.");
  }
  if (await emTroca(a.id)) {
    return erro(409, "EM_TROCA", "Esse plantão está numa troca em andamento. Cancele a troca em Trocas antes de mudar de base.");
  }

  const [o] = await db
    .select({
      id: extraShiftOffers.id, baseId: extraShiftOffers.baseId, date: extraShiftOffers.date, period: extraShiftOffers.period,
      shift: extraShiftOffers.shift, releasedFacultyId: extraShiftOffers.releasedFacultyId, autoRelease: extraShiftOffers.autoRelease,
      claimedBy: extraShiftOffers.claimedBy, cancelledAt: extraShiftOffers.cancelledAt, reservedBy: extraShiftOffers.reservedBy,
      baseCode: bases.code, baseType: bases.type,
    })
    .from(extraShiftOffers)
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .where(eq(extraShiftOffers.id, p.offerId))
    .limit(1);
  if (!o || o.claimedBy || o.cancelledAt || o.reservedBy) return erro(409, "VAGA_FOI", "Essa vaga já não está livre.");
  const destino = { ...o, date: String(o.date).slice(0, 10), tipo: goalKindOf(o.baseType) };
  const motivo = motivoParaNaoMudar({ ...a, date, tipo: goalKindOf(a.baseType) }, destino);
  if (motivo) return erro(409, "NAO_SERVE", motivo);
  if (naRepescagem(date, period, o.shift, now)) {
    return erro(409, "REPESCAGEM", "Essa vaga já está na repescagem: vai a sorteio entre os inscritos em Extras → Sorteios.");
  }
  if (!(await soAsQueCabem([{ baseCode: o.baseCode, tipo: destino.tipo, date, period }])).length) {
    return erro(409, "LOTADA", `A ${o.baseCode} já está no teto de internos nesse turno.`);
  }

  const offerId = await db.transaction(async (tx) => {
    const [pega] = await tx.update(extraShiftOffers)
      .set({ claimedBy: a.internId, claimedAt: now, assignmentId: a.id })
      .where(and(eq(extraShiftOffers.id, o.id), isNull(extraShiftOffers.claimedBy), isNull(extraShiftOffers.cancelledAt), isNull(extraShiftOffers.reservedBy)))
      .returning({ id: extraShiftOffers.id });
    if (!pega) return null;
    const nota = notaDeMudanca(a.baseCode, o.baseCode, now);
    const [movido] = await tx.update(assignments)
      .set({ baseId: o.baseId, shift: o.shift ?? a.shift, notes: sql`CASE WHEN COALESCE(${assignments.notes}, '') = '' THEN ${nota} ELSE ${assignments.notes} || E'\n' || ${nota} END`, updatedAt: now })
      .where(and(eq(assignments.id, a.id), eq(assignments.baseId, a.baseId), inArray(assignments.status, [...AGENDADO])))
      .returning({ id: assignments.id });
    if (!movido) {
      tx.rollback();
      return null;
    }
    const [livre] = await tx.insert(extraShiftOffers).values({
      baseId: a.baseId, date, period, shift: a.shift,
      publishedBy: a.internId,
      releasedFacultyId: a.facultyId,
      autoRelease: ORIGEM_INTERNO,
      notes: `Liberada pelo interno (${a.facultyAbbr}): mudou para a ${o.baseCode}`,
    }).returning({ id: extraShiftOffers.id });
    return livre.id;
  }).catch(() => null);
  if (!offerId) return erro(409, "MUDOU", "A vaga ou o plantão mudou agora há pouco. Pergunte à Dai de novo e confira.");

  const turno = quando(date, period, a.shift);
  await logAudit({
    userId: a.internId,
    action: "INTERN_MOVED_BASE",
    entity: "assignment",
    entityId: a.id,
    payload: { de: a.baseCode, para: o.baseCode, vagaPega: o.id, vagaAberta: offerId, date, period, shift: a.shift, facultyAbbr: a.facultyAbbr },
  });

  // Avisos nunca derrubam a mudança: ela já aconteceu.
  await avisarLideres(
    { id: a.id, facultyId: a.facultyId },
    a.internId,
    `🔁 ${a.internName} mudou o plantão **${turno}** da ${a.baseCode} para a ${o.baseCode}, numa vaga livre.\nA meta dele não muda. O lugar na ${a.baseCode} ficou livre para todas as faculdades, inclusive a sua.`,
    "DAI_AVISO_MUDANCA_DE_BASE",
  );
  void avisarCoordenacaoNoTelegram(`🔁 Interno mudou de base\n${turno}\nInterno: ${a.internName} (${a.facultyAbbr})\n${a.baseCode} → ${o.baseCode} (vaga livre)\nO lugar na ${a.baseCode} ficou livre para todas as faculdades.`);

  return {
    status: 200,
    body: {
      success: true,
      data: { baseCode: o.baseCode, offerId, texto: `Pronto: seu plantão ${turno} agora é na ${o.baseCode}. O lugar na ${a.baseCode} ficou livre para os colegas, e seu líder e a coordenação foram avisados.` },
    },
  } as const;
}
