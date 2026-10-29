import { db } from "@/shared/db/client";
import { eq } from "drizzle-orm";
import { assignments, bases, faculties, users } from "@/shared/db/schema";
import {
  claimExtraOffer,
  getExtraOfferById,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { logAudit } from "@/shared/infra/logger/audit";
import { findAssignmentByInternSlot } from "@/features/scheduling/infra/repositories/assignment-repository";
import { getValidInternIdsForFaculty } from "@/features/scheduling/infra/repositories/lottery-repository";
import { localDateStr } from "@/lib/utils";
import { avisarCoordenacaoNoTelegram } from "@/lib/telegram-coordenacao";
import { findPendingFreeSlotRequest, insertRequest } from "@/features/requests/infra/repositories/request-repository";
import { semDescansoPara } from "@/features/scheduling/application/descanso";
import { metaDoInternoNoTipo, textoMetaCumprida } from "./free-slot-goal";
import { comExtraNoHistorico, naRepescagem, TEXTO_JA_TEVE_EXTRA } from "../repescagem";
import { soAsQueCabem } from "../lotacao";
import { goalKindOf } from "@/lib/goal-slots";

/**
 * Oferta de data passada não se pega. O board e a grade já não mostram; isto é
 * a trava no servidor para quem chama a rota direto. A exceção é a mesma de
 * create-assignment: a coordenação, com o override retroativo explícito, que
 * fica na auditoria.
 */
export function bloqueiaDataPassada(params: {
  offerDate: string;
  actorRole: string;
  allowRetroactiveOverride?: boolean;
  today?: string;
}): boolean {
  if (params.offerDate >= (params.today ?? localDateStr())) return false;
  return !(params.actorRole === "COORDINATOR" && params.allowRetroactiveOverride === true);
}

/**
 * Aviso no privado da coordenação quando alguém usa vaga liberada pelo
 * sistema (auto-release-slots.ts) — para acompanhar quem está pegando o quê.
 * Liberação manual não avisa: foi a faculdade que decidiu ceder.
 */
export function textoVagaAutomaticaUsada(p: {
  autoRelease: string;
  releasedByAbbr: string | null;
  baseCode: string;
  date: string;
  period: string;
  internName: string;
  facultyAbbr: string;
  actorName: string;
  actorRole: string;
}) {
  const data = `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`;
  const turno = p.period === "NIGHT" ? "noturno" : "diurno";
  const origem = p.autoRelease === "SEM_DONO"
    ? "Vaga sem dono usada"
    : `Vaga liberada pelo prazo da ${p.releasedByAbbr ?? "outra faculdade"} usada`;
  const quem = p.actorRole === "COORDINATOR"
    ? `${p.actorName} (coordenação)`
    : p.actorRole === "INTERN"
      ? "o próprio interno, na repescagem"
      : `${p.actorName} (líder ${p.facultyAbbr})`;
  return `🔓 ${origem}\n${p.baseCode} · ${data} ${turno}\nInterno: ${p.internName} (${p.facultyAbbr})\nEscalado por: ${quem}`;
}

/**
 * Duas situações passam por aqui:
 * - Extra comum: o interno (ou o líder, por si) pega a oferta do board.
 * - Vaga livre (oferta com `releasedFacultyId`): o líder ou o coordenador
 *   aloca um interno da faculdade dele na vaga que outra faculdade liberou.
 *   Vira plantão normal, não extra — é o plantão do interno, só que numa vaga
 *   emprestada. Ver release-slots.ts.
 */
export async function executeClaimExtraOffer(params: {
  actor: { id: string; role: string; facultyId: string | null };
  offerId: string;
  /** Líder/coordenador alocando outro interno. Sem isso, o ator pega para si. */
  internId?: string;
  /** Coordenador precisa dizer a faculdade do interno; o líder usa a dele. */
  facultyId?: string;
  /** Coordenador escalando em data passada pela grade dele. Ver bloqueiaDataPassada. */
  allowRetroactiveOverride?: boolean;
  /** Coordenador visitando a tela do líder: não passa pela trava da meta. */
  isImpersonating?: boolean;
  /** Interno acima da meta: em vez de alocar, deixa o pedido para a coordenação. */
  pedirAutorizacao?: boolean;
  /** Aprovação de pedido (review-request.ts): o plantão fica no nome do líder que pediu. */
  createdBy?: string;
}) {
  const { actor, offerId } = params;

  const alocandoOutro = Boolean(params.internId && params.internId !== actor.id);
  const permitido = alocandoOutro
    ? ["LEADER", "COORDINATOR"].includes(actor.role)
    : ["INTERN", "LEADER"].includes(actor.role);
  if (!permitido) {
    return { status: 403, body: { success: false, error: "Sem permissão" } } as const;
  }

  const offer = await getExtraOfferById(offerId);
  if (!offer) {
    return { status: 404, body: { success: false, error: "Oferta não encontrada" } } as const;
  }
  if (offer.cancelledAt) {
    return { status: 409, body: { success: false, error: "Este plantão extra foi cancelado" } } as const;
  }
  if (offer.claimedBy) {
    return { status: 409, body: { success: false, error: "Esta vaga já foi preenchida" } } as const;
  }
  if (offer.reservedBy) {
    return { status: 409, body: { success: false, error: "Esta vaga está reservada pela coordenação" } } as const;
  }
  const today = localDateStr();
  if (bloqueiaDataPassada({ offerDate: offer.date, actorRole: actor.role, allowRetroactiveOverride: params.allowRetroactiveOverride, today })) {
    return { status: 400, body: { success: false, error: "Não dá para usar vaga de data passada" } } as const;
  }
  const retroativo = offer.date < today;

  // Always use the intern's own faculty so the assignment appears in the
  // correct leader view and compliance report. offer.facultyId is only a display hint.
  const facultyId = actor.role === "COORDINATOR" ? params.facultyId ?? null : actor.facultyId;
  if (!facultyId) {
    return { status: 422, body: { success: false, error: "Não foi possível determinar a faculdade. Tente novamente ou contate a coordenação." } } as const;
  }

  // Vaga que a própria faculdade liberou é para as outras — se ela usasse,
  // estaria ocupando a vaga que disse que não ia usar.
  if (offer.releasedFacultyId && offer.releasedFacultyId === facultyId) {
    return { status: 409, body: { success: false, error: "Sua faculdade liberou esta vaga para as outras" } } as const;
  }

  const internId = params.internId ?? actor.id;
  if (alocandoOutro) {
    const validos = await getValidInternIdsForFaculty({ facultyId, internIds: [internId] });
    if (!validos.has(internId)) {
      return { status: 400, body: { success: false, error: "Interno não pertence a esta faculdade" } } as const;
    }
  }

  // Check the intern doesn't already have an assignment in this slot
  const existing = await findAssignmentByInternSlot({
    internId,
    date: offer.date,
    period: offer.period,
    shift: (offer.shift as "MORNING" | "AFTERNOON" | null | undefined) ?? null,
  });
  if (existing && existing.status !== "CANCELLED") {
    return { status: 409, body: { success: false, error: alocandoOutro ? "Este interno já tem um plantão neste dia e turno" : "Você já tem um plantão neste dia e turno" } } as const;
  }

  // 12h de descanso em todo plantão novo — extra e vaga livre também. Só a
  // escala retroativa da coordenação (registro do que já aconteceu) passa.
  const [baseDaVaga] = await db.select({ code: bases.code, type: bases.type }).from(bases).where(eq(bases.id, offer.baseId)).limit(1);
  if (!retroativo) {
    const semDescanso = await semDescansoPara(internId, alocandoOutro ? "O interno" : "Você", {
      date: offer.date,
      period: offer.period as "DAY" | "NIGHT",
      shift: offer.shift,
      baseCode: baseDaVaga?.code ?? "",
    });
    if (semDescanso) return { status: 409, body: { success: false, code: "SEM_DESCANSO", error: semDescanso } } as const;
  }

  // Vaga sem dono (auto-release-slots.ts) também é vaga livre: vira plantão
  // normal do interno, só não tem faculdade que liberou.
  const vagaLivre = Boolean(offer.releasedFacultyId) || offer.autoRelease === "SEM_DONO";
  // 8h antes do turno a vaga livre vira extra (repescagem.ts): qualquer um
  // pega, sem líder e sem a trava da meta.
  const repescagem = vagaLivre && !retroativo && naRepescagem(offer.date, offer.period as "DAY" | "NIGHT", offer.shift);
  // Fora da repescagem, interno não se escala em vaga livre: quem escala é o
  // líder (abaixo da meta) ou a coordenação, pela candidatura
  // (candidatar-vaga-livre.ts). A tela não oferece isso; aqui fecha o POST direto.
  if (vagaLivre && !repescagem && actor.role === "INTERN" && !alocandoOutro) {
    return { status: 403, body: { success: false, code: "VAGA_LIVRE_PELO_LIDER", error: "Vaga livre é escalada pelo líder da sua faculdade. Se sua meta já fechou, candidate-se pela Dai." } } as const;
  }
  const [quemLiberou] = vagaLivre && offer.releasedFacultyId
    ? await db.select({ abbr: faculties.abbreviation }).from(faculties).where(eq(faculties.id, offer.releasedFacultyId)).limit(1)
    : [null];

  // Sem o líder no meio, a trava da viatura cheia fica aqui (lotacao.ts).
  if (repescagem && baseDaVaga) {
    const turno = { baseCode: baseDaVaga.code, tipo: goalKindOf(baseDaVaga.type), date: offer.date, period: offer.period as "DAY" | "NIGHT" };
    if (!(await soAsQueCabem([turno])).length) {
      return { status: 409, body: { success: false, code: "BASE_CHEIA", error: "A base já está com a equipe completa nesse turno." } } as const;
    }
  }

  // Na repescagem, quem já fechou a meta do tipo leva o plantão como extra:
  // não conta na meta, como o extra comum.
  const metaNaRepescagem = repescagem && baseDaVaga ? await metaDoInternoNoTipo(internId, baseDaVaga.type) : null;
  const comoExtra = !vagaLivre || Boolean(metaNaRepescagem?.cumprida);
  // Extra de última hora é um por interno: quem já teve não ganha outro por
  // ter visto primeiro. A coordenação decide por fora dessa trava.
  if (repescagem && comoExtra && actor.role !== "COORDINATOR" && !params.isImpersonating && (await comExtraNoHistorico([internId])).has(internId)) {
    return { status: 409, body: { success: false, code: "JA_TEVE_EXTRA", error: `${alocandoOutro ? "O interno" : "Você"} ${TEXTO_JA_TEVE_EXTRA}` } } as const;
  }

  // Vaga livre é para quem precisa: o líder só escala sozinho interno abaixo
  // da meta do tipo da vaga. Acima disso, só com aprovação da coordenação.
  if (vagaLivre && !repescagem && actor.role === "LEADER" && !params.isImpersonating) {
    const meta = baseDaVaga ? await metaDoInternoNoTipo(internId, baseDaVaga.type) : null;
    if (meta?.cumprida) {
      const [interno] = await db.select({ name: users.name }).from(users).where(eq(users.id, internId)).limit(1);
      if (!params.pedirAutorizacao) {
        return {
          status: 409,
          body: { success: false, code: "META_CUMPRIDA", error: textoMetaCumprida(interno?.name ?? "O interno", meta) },
        } as const;
      }
      return pedirVagaLivre({ actor, offer, internId, internName: interno?.name ?? "interno", meta });
    }
  }

  // Create the assignment inside a transaction
  let assignmentId: string;
  try {
    const [newAssignment] = await db
      .insert(assignments)
      .values({
        internId,
        facultyId,
        baseId: offer.baseId,
        date: offer.date,
        period: offer.period,
        shift: (offer.shift as "MORNING" | "AFTERNOON") ?? undefined,
        status: "SCHEDULED",
        isExtraShift: comoExtra,
        extraShiftNotes: vagaLivre ? null : offer.notes ?? null,
        createdBy: params.createdBy ?? actor.id,
        notes: vagaLivre
          ? (offer.releasedFacultyId
            ? `Vaga livre liberada pela ${quemLiberou?.abbr ?? "outra faculdade"}`
            : "Vaga livre sem dono na grade") + (repescagem ? " — pega na repescagem" : "")
          : `Plantão extra — oferta pública #${offerId.slice(0, 8)}`,
      })
      .returning({ id: assignments.id });
    assignmentId = newAssignment.id;
  } catch {
    return { status: 409, body: { success: false, error: "Conflito ao criar plantão. Tente novamente." } } as const;
  }

  // Atomic claim — if another request beat us, the update returns 0 rows
  const claimed = await claimExtraOffer(offerId, internId, assignmentId);
  if (!claimed) {
    // Rollback the assignment just created
    await db.delete(assignments).where(eq(assignments.id, assignmentId)).catch(() => {
      // best-effort cleanup
    });
    return { status: 409, body: { success: false, error: "Esta vaga acabou de ser preenchida por outra pessoa" } } as const;
  }

  if (vagaLivre) {
    // Nomes no payload de propósito: a auditoria mostra isto em português.
    const [[interno], [bs], [fac]] = await Promise.all([
      db.select({ name: users.name }).from(users).where(eq(users.id, internId)).limit(1),
      db.select({ code: bases.code }).from(bases).where(eq(bases.id, offer.baseId)).limit(1),
      db.select({ abbr: faculties.abbreviation }).from(faculties).where(eq(faculties.id, facultyId)).limit(1),
    ]);
    await logAudit({
      userId: actor.id,
      action: "FREE_SLOT_USED",
      entity: "extra_shift_offers",
      entityId: offerId,
      payload: {
        assignmentId,
        internName: interno?.name ?? null,
        facultyAbbr: fac?.abbr ?? null,
        releasedByAbbr: quemLiberou?.abbr ?? null,
        autoRelease: offer.autoRelease ?? null,
        baseCode: bs?.code ?? null,
        date: offer.date,
        period: offer.period,
        ...(repescagem ? { repescagem: true, comoExtra } : {}),
        ...(retroativo ? { allowRetroactiveOverride: true } : {}),
      },
    });
    // A coordenação não precisa ser avisada do que ela mesma fez.
    if (offer.autoRelease && actor.role !== "COORDINATOR") {
      const [ator] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.id)).limit(1);
      // Sem await: o aviso nunca atrasa nem derruba a alocação.
      void avisarCoordenacaoNoTelegram(textoVagaAutomaticaUsada({
        autoRelease: offer.autoRelease,
        releasedByAbbr: quemLiberou?.abbr ?? null,
        baseCode: bs?.code ?? "base",
        date: offer.date,
        period: offer.period,
        internName: interno?.name ?? "interno",
        facultyAbbr: fac?.abbr ?? "?",
        actorName: ator?.name ?? "alguém",
        actorRole: actor.role,
      }));
    }
  } else {
    await logAudit({
      userId: actor.id,
      action: "extra_offer.claimed",
      entity: "extra_shift_offers",
      entityId: offerId,
      payload: { assignmentId, date: offer.date, baseId: offer.baseId, ...(retroativo ? { allowRetroactiveOverride: true } : {}) },
    });
  }

  return {
    status: 200,
    body: { success: true, data: { assignmentId, offerId } },
  } as const;
}

/** Pedido do líder para escalar acima da meta. Não segura a vaga: quem pegar antes, leva. */
/** Pedido de vaga livre para a coordenação: do líder por um interno, ou do próprio interno (candidatura). */
export async function pedirVagaLivre(p: {
  actor: { id: string; role: string };
  offer: { id: string; baseId: string; date: string; period: "DAY" | "NIGHT" };
  internId: string;
  internName: string;
  meta: { kind: string; target: number };
}) {
  const jaPedido = await findPendingFreeSlotRequest({ offerId: p.offer.id, internId: p.internId });
  if (jaPedido) {
    return { status: 200, body: { success: true, data: { requested: true, requestId: jaPedido.id, already: true } } } as const;
  }
  const pedido = await insertRequest({
    type: "FREE_SLOT",
    requesterId: p.actor.id,
    assignmentId: null,
    targetInternId: p.internId,
    targetAssignmentId: null,
    extraBaseId: p.offer.baseId,
    extraDate: p.offer.date,
    extraPeriod: p.offer.period,
    extraOfferId: p.offer.id,
    status: "PENDING",
  });

  const [[lider], [bs]] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, p.actor.id)).limit(1),
    db.select({ code: bases.code }).from(bases).where(eq(bases.id, p.offer.baseId)).limit(1),
  ]);
  await logAudit({
    userId: p.actor.id,
    action: "FREE_SLOT_REQUESTED",
    entity: "request",
    entityId: pedido.id,
    payload: { offerId: p.offer.id, internName: p.internName, baseCode: bs?.code ?? null, date: p.offer.date, period: p.offer.period, metaKind: p.meta.kind, metaTarget: p.meta.target },
  });
  const data = `${p.offer.date.slice(8, 10)}/${p.offer.date.slice(5, 7)}`;
  const candidatura = p.actor.id === p.internId;
  void avisarCoordenacaoNoTelegram(
    `📝 ${candidatura ? "Candidatura a vaga livre" : "Pedido de vaga livre acima da meta"}\n${bs?.code ?? "base"} · ${data} ${p.offer.period === "NIGHT" ? "noturno" : "diurno"}\n`
    + `Interno: ${p.internName} (meta de ${p.meta.kind} já coberta)\n`
    + `${candidatura ? "O próprio interno se candidatou (sobra vaga depois de quem precisa de reposição)." : `Pedido por: ${lider?.name ?? "líder"}`}\nAprove em Admin → Solicitações.`,
  );
  return { status: 200, body: { success: true, data: { requested: true, requestId: pedido.id } } } as const;
}
