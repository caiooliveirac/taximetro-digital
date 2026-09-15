/**
 * Remanejamento pelo próprio interno, no plantão em andamento.
 *
 * GET  ?assignmentId=  — a grade de hoje inteira: cada USA com suas células
 *                        (quem está lá, com ou sem check-in, e as livres) e o
 *                        médico presente (quando o canal com o `plantoes` existe).
 * POST {assignmentId, newBaseId} — ocupa a vaga na hora e avisa a coordenação.
 *
 * Só depois de um aviso (sem médico / sem enfermeiro / viatura) neste mesmo
 * plantão: o aviso é o gatilho, e é o que impede virar "mudo para a base perto
 * de casa". Pode repetir no mesmo plantão — ele pode ter se enganado de base.
 * Vale antes ou depois do check-in: o caso real é o interno que já chegou e
 * encontrou a base parada.
 *
 * A vaga é ocupada dentro de um advisory lock por (base, data, turno): dois
 * internos correndo para a mesma vaga entram um de cada vez, e o segundo já
 * não a encontra. O remanejamento em si é o mesmo caso de uso do admin/líder,
 * que grava a nota [REMANEJADO] e o audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, auditLog, bases, faculties, slotRules, users } from "@/db/schema";
import { getEffectiveUser, type EffectiveUser } from "@/lib/impersonate";
import { checkPeriodOccupancy, getDayOfWeek } from "@/lib/slots";
import { formatBrazilTime, isCurrentOperationalAssignment } from "@/lib/utils";
import { avisarSecretario, STATUS_NA_BASE } from "@/lib/aviso-tom";
import { celulasDaBase, compararCodigoDeBase, motivoDoRemanejamento, textoDoRemanejamento, vagasNaGrade, type Ocupante } from "@/lib/remanejamento-interno";
import { medicosNasBasesAgora, canalDoPlantoesConfigurado } from "@/features/scheduling/infra/repositories/plantoes-medicos-repository";
import { executeReassignAssignmentBase } from "@/features/scheduling/application/use-cases/reassign-assignment-base";

type Plantao = {
  id: string;
  baseId: string;
  baseCode: string;
  date: string;
  period: "DAY" | "NIGHT";
  status: string;
  isExtraShift: boolean;
  interno: string;
  faculdade: string | null;
};

type Falha = { status: number; error: string };

async function plantaoEmAndamento(user: EffectiveUser, assignmentId: string): Promise<Plantao | Falha> {
  const [plantao] = await db
    .select({
      id: assignments.id,
      baseId: assignments.baseId,
      baseCode: bases.code,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
      isExtraShift: assignments.isExtraShift,
      interno: users.name,
      faculdade: faculties.name,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .leftJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, user.id)))
    .limit(1);

  if (!plantao) return { status: 404, error: "Plantão não encontrado" };
  if (!STATUS_NA_BASE.has(plantao.status) || !isCurrentOperationalAssignment(plantao.date, plantao.period)) {
    return { status: 409, error: "O remanejamento só vale para o plantão em andamento." };
  }
  if (plantao.isExtraShift) {
    return { status: 409, error: "Plantão extra não pode ser remanejado pelo interno." };
  }
  return plantao;
}

/** Último aviso deste plantão, ou null: sem aviso não há remanejamento. */
async function ultimoAviso(assignmentId: string): Promise<string | null> {
  const [aviso] = await db
    .select({ payload: auditLog.payload })
    .from(auditLog)
    .where(and(eq(auditLog.action, "INTERN_ALERT_SENT"), eq(auditLog.entityId, assignmentId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  if (!aviso) return null;
  const tipo = (aviso.payload as { tipo?: string } | null)?.tipo;
  return tipo ?? "";
}

const SEM_AVISO = "Avise a coordenação primeiro (sem médico, sem enfermeiro ou problema na viatura).";

/**
 * A grade de hoje, base por base: quantas células tem cada USA neste turno
 * (soma de slot_rules de todas as faculdades) e quem já está em cada uma.
 * Duas consultas para todas as bases, em vez de uma por base.
 */
async function gradeDoTurno(plantao: Plantao) {
  const dayOfWeek = getDayOfWeek(plantao.date);

  const capacidade = await db
    .select({ baseId: slotRules.baseId, capacity: sql<number>`COALESCE(SUM(${slotRules.capacity}), 0)` })
    .from(slotRules)
    .where(
      and(
        eq(slotRules.dayOfWeek, dayOfWeek),
        eq(slotRules.period, plantao.period),
        eq(slotRules.isActive, true),
        eq(slotRules.isBlocked, false),
        eq(slotRules.isExtraShift, false),
      ),
    )
    .groupBy(slotRules.baseId);
  const capacidadePorBase = new Map(capacidade.map((c) => [c.baseId, Number(c.capacity)]));

  const ocupantes = await db
    .select({ baseId: assignments.baseId, faculdade: faculties.abbreviation, status: assignments.status })
    .from(assignments)
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(
      and(
        eq(assignments.date, plantao.date),
        eq(assignments.period, plantao.period),
        eq(assignments.isExtraShift, false),
        notInArray(assignments.status, ["CANCELLED", "ABSENT"]),
      ),
    )
    .orderBy(assignments.createdAt);
  const ocupantesPorBase = new Map<string, Ocupante[]>();
  for (const o of ocupantes) ocupantesPorBase.set(o.baseId, [...(ocupantesPorBase.get(o.baseId) ?? []), o]);

  const usas = await db
    .select({ id: bases.id, code: bases.code, name: bases.name })
    .from(bases)
    .where(and(eq(bases.type, "USA"), eq(bases.isActive, true)));

  return usas
    .sort((a, b) => compararCodigoDeBase(a.code, b.code))
    .map((base) => ({
      ...base,
      atual: base.id === plantao.baseId,
      celulas: celulasDaBase(capacidadePorBase.get(base.id) ?? 0, ocupantesPorBase.get(base.id) ?? []),
    }));
}

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const assignmentId = req.nextUrl.searchParams.get("assignmentId") ?? "";
  if (!z.string().uuid().safeParse(assignmentId).success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }

  const plantao = await plantaoEmAndamento(user, assignmentId);
  if ("error" in plantao) return NextResponse.json({ success: false, error: plantao.error }, { status: plantao.status });
  if ((await ultimoAviso(plantao.id)) === null) {
    return NextResponse.json({ success: false, error: SEM_AVISO }, { status: 409 });
  }

  const grade = await gradeDoTurno(plantao);
  const medicos = await medicosNasBasesAgora(grade.map((b) => b.code));

  return NextResponse.json({
    success: true,
    data: {
      medicosDisponiveis: canalDoPlantoesConfigurado(),
      bases: grade.map((b) => ({ ...b, medicos: medicos[b.code] ?? [] })),
    },
  });
}

const postSchema = z.object({
  assignmentId: z.string().uuid(),
  newBaseId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }
  const { assignmentId, newBaseId } = parsed.data;

  const plantao = await plantaoEmAndamento(user, assignmentId);
  if ("error" in plantao) return NextResponse.json({ success: false, error: plantao.error }, { status: plantao.status });
  const tipo = await ultimoAviso(plantao.id);
  if (tipo === null) return NextResponse.json({ success: false, error: SEM_AVISO }, { status: 409 });
  const motivo = motivoDoRemanejamento(tipo);

  const [destino] = await db
    .select({ id: bases.id, code: bases.code, type: bases.type, isActive: bases.isActive })
    .from(bases)
    .where(eq(bases.id, newBaseId))
    .limit(1);
  if (!destino || !destino.isActive || destino.type !== "USA") {
    return NextResponse.json({ success: false, error: "Base de destino inválida" }, { status: 404 });
  }

  // O lock vive nesta transação; o caso de uso escreve pela conexão do pool,
  // mas só depois de o lock ser nosso, e o update dele já está commitado quando
  // o lock solta. Quem vier depois lê a vaga já ocupada.
  const chave = `remanejamento:${destino.id}:${plantao.date}:${plantao.period}`;
  const resultado = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${chave}))`);

    const load = await checkPeriodOccupancy(destino.id, plantao.date, plantao.period);
    if (vagasNaGrade(load) === 0) {
      return { status: 409, body: { success: false, error: `A ${destino.code} já não tem vaga neste turno.` } } as const;
    }

    return executeReassignAssignmentBase({
      actor: {
        id: user.id,
        role: user.role,
        facultyId: user.facultyId,
        isImpersonating: user.isImpersonating,
        realUserId: user.realUserId,
      },
      input: {
        assignmentId: plantao.id,
        newBaseId: destino.id,
        reason: `Remanejamento pelo interno: ${motivo}`,
        authorized: true,
      },
    });
  });

  if (resultado.status !== 200) return NextResponse.json(resultado.body, { status: resultado.status });

  const entregue = await avisarSecretario(
    textoDoRemanejamento({
      interno: plantao.interno,
      faculdade: plantao.faculdade,
      de: plantao.baseCode,
      para: destino.code,
      hora: formatBrazilTime(new Date()),
      motivo,
    }),
  );

  return NextResponse.json({ success: true, data: { baseCode: destino.code, entregue } });
}
