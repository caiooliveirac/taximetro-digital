import { z } from "zod/v4";
import { checkCruConflict, checkPeriodOccupancy, checkSlotAvailability } from "@/lib/slots";
import { localDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import { canLeaderManageFaculty } from "@/features/scheduling/domain/policies/assignment-policy";
import {
  createAssignment,
  findAssignmentByInternSlot,
  getFacultyAbbreviationById,
  getInternPrimaryFacultyId,
  reactivateAssignment,
  type ShiftValue,
} from "@/features/scheduling/infra/repositories/assignment-repository";

export const createAssignmentSchema = z.object({
  internId: z.string().uuid(),
  facultyId: z.string().uuid(),
  baseId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.enum(["DAY", "NIGHT"]),
  shift: z.enum(["MORNING", "AFTERNOON"]).nullish(),
  notes: z.string().optional(),
  allowRetroactiveOverride: z.boolean().optional(),
  allowAdminOpenAllocation: z.boolean().optional(),
  isExtraShift: z.boolean().optional().default(false),
  extraShiftNotes: z.string().nullish(),
});

export type AssignmentActor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeCreateAssignment(params: {
  actor: AssignmentActor;
  input: z.infer<typeof createAssignmentSchema>;
}) {
  const { actor, input } = params;
  const isExtra = input.isExtraShift ?? false;

  // input.facultyId = faculdade da vaga na grade (usado para checagem de capacidade e permissão do líder)
  // resolvedFacultyId = faculdade real do interno (gravada no assignment, determina visibilidade e compliance)
  const resolvedFacultyId = await getInternPrimaryFacultyId(input.internId) ?? input.facultyId;

  if (!isExtra && !canLeaderManageFaculty({
    actorRole: actor.role,
    actorFacultyId: actor.facultyId,
    targetFacultyId: input.facultyId,
  })) {
    return { status: 403, body: { success: false, error: "Só pode alocar internos da sua faculdade" } } as const;
  }

  const facultyAbbreviation = await getFacultyAbbreviationById(resolvedFacultyId);
  const shiftValue: ShiftValue = facultyAbbreviation === "EBMSP" ? (input.shift ?? null) : null;
  const allowCoordinatorRetroactiveOverride = actor.role === "COORDINATOR"
    && input.allowRetroactiveOverride === true
    && input.date < localDateStr();
  const allowCoordinatorOpenAllocation = actor.role === "COORDINATOR" && input.allowAdminOpenAllocation === true;

  const existingAssignment = await findAssignmentByInternSlot({
    internId: input.internId,
    date: input.date,
    period: input.period,
    shift: shiftValue,
  });

  if (existingAssignment && existingAssignment.status !== "CANCELLED") {
    return {
      status: 409,
      body: { success: false, error: "Interno já possui plantão neste dia e turno" },
    } as const;
  }

  const isCancelledSameSlot = existingAssignment?.status === "CANCELLED"
    && existingAssignment.baseId === input.baseId
    && existingAssignment.facultyId === resolvedFacultyId;

  if (!isCancelledSameSlot) {
    // Teto duro da base no turno: vale para grade, alocação livre do admin e
    // sorteio. Sem isso, dois internos da mesma faculdade em vagas de
    // faculdades diferentes deixam a checagem por faculdade cega e um terceiro
    // interno entra na base.
    if (!isExtra) {
      const load = await checkPeriodOccupancy(input.baseId, input.date, input.period, shiftValue);
      if (load.full) {
        return {
          status: 409,
          body: {
            success: false,
            error: `Base lotada neste turno (${load.occupied}/${load.capacity}). Remova um interno antes de alocar outro.`,
          },
        } as const;
      }
    }

    if (!isExtra && !allowCoordinatorOpenAllocation) {
      const slot = await checkSlotAvailability(
        input.baseId,
        input.date,
        input.period,
        input.facultyId,
        shiftValue,
      );
      if (!slot.available) {
        return {
          status: 409,
          body: { success: false, error: `Sem vaga (${slot.assigned}/${slot.capacity})` },
        } as const;
      }
    }

    if (!allowCoordinatorRetroactiveOverride && !isExtra) {
      const cruCheck = await checkCruConflict(input.internId, input.date, input.period, undefined, input.baseId);
      if (cruCheck.conflicted) {
        return { status: 409, body: { success: false, error: cruCheck.reason } } as const;
      }
    }
  }

  try {
    if (existingAssignment?.status === "CANCELLED") {
      const reactivated = await reactivateAssignment({
        id: existingAssignment.id,
        facultyId: resolvedFacultyId,
        baseId: input.baseId,
        shift: shiftValue,
        isExtraShift: isExtra,
        extraShiftNotes: input.extraShiftNotes ?? null,
        notes: input.notes ?? null,
      });

      await logAudit({
        userId: actor.realUserId ?? actor.id,
        action: isExtra ? "EXTRA_SHIFT_CREATED" : "REACTIVATE_CANCELLED_ASSIGNMENT",
        entity: "assignment",
        entityId: existingAssignment.id,
        payload: {
          internId: input.internId,
          facultyId: resolvedFacultyId,
          baseId: input.baseId,
          date: input.date,
          period: input.period,
          shift: shiftValue,
          isExtraShift: isExtra,
          extraShiftNotes: input.extraShiftNotes,
          allowRetroactiveOverride: allowCoordinatorRetroactiveOverride,
          allowAdminOpenAllocation: allowCoordinatorOpenAllocation,
          ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
        },
      });

      return { status: 200, body: { success: true, data: reactivated, reusedCancelled: true } } as const;
    }

    const created = await createAssignment({
      internId: input.internId,
      // Grava a faculdade real do interno (resolvedFacultyId), não a faculdade da vaga na grade.
      // Assim um interno UNIFACS alocado em vaga ZARNS aparece como UNIFACS em escalas, relatórios
      // e no app dele para check-in, sem alterar a slotRules (grade segue ZARNS para outras semanas).
      facultyId: resolvedFacultyId,
      baseId: input.baseId,
      date: input.date,
      period: input.period,
      shift: shiftValue,
      isExtraShift: isExtra,
      extraShiftNotes: input.extraShiftNotes ?? null,
      notes: input.notes ?? null,
      createdBy: actor.realUserId ?? actor.id,
    });

    await logAudit({
      userId: actor.realUserId ?? actor.id,
      action: isExtra ? "EXTRA_SHIFT_CREATED" : "CREATE_ASSIGNMENT",
      entity: "assignment",
      entityId: created.id,
      payload: {
        internId: input.internId,
        facultyId: resolvedFacultyId,
        slotFacultyId: input.facultyId,
        baseId: input.baseId,
        date: input.date,
        period: input.period,
        shift: shiftValue,
        isExtraShift: isExtra,
        extraShiftNotes: input.extraShiftNotes,
        allowRetroactiveOverride: allowCoordinatorRetroactiveOverride,
        allowAdminOpenAllocation: allowCoordinatorOpenAllocation,
        ...(actor.isImpersonating ? { impersonating: actor.id } : {}),
      },
    });

    return { status: 201, body: { success: true, data: created } } as const;
  } catch (err: unknown) {
    const cause = typeof err === "object" && err !== null && "cause" in err
      ? (err as { cause?: { code?: string; constraint_name?: string } }).cause
      : undefined;
    if (cause?.code === "23505") {
      return {
        status: 409,
        body: { success: false, error: "Interno já possui plantão neste dia e turno" },
      } as const;
    }

    // FK violation em created_by: o usuário do JWT não existe mais no banco
    // (sessão anterior a uma restauração/merge). A sessão precisa ser refeita.
    if (cause?.code === "23503" && cause.constraint_name === "assignments_created_by_users_id_fk") {
      return {
        status: 401,
        body: { success: false, error: "Sua sessão está desatualizada. Saia da conta e faça login novamente." },
      } as const;
    }

    const errorCode = typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: string }).code
      : undefined;

    console.error("create-assignment use case failed", {
      errorCode,
      causeCode: cause?.code,
      userId: actor.realUserId ?? actor.id,
      role: actor.role,
      payload: {
        internId: input.internId,
        facultyId: input.facultyId,
        baseId: input.baseId,
        date: input.date,
        period: input.period,
      },
      allowRetroactiveOverride: allowCoordinatorRetroactiveOverride,
      allowAdminOpenAllocation: allowCoordinatorOpenAllocation,
    });

    return {
      status: 500,
      body: { success: false, error: "Falha ao criar ou reativar plantão. Se o problema persistir, contate o suporte." },
    } as const;
  }
}
