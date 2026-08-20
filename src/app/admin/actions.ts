"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { canRecordManualAttendance } from "@/lib/attendance-permissions";
import { sessionHasRole } from "@/lib/roles";
import { checkRateLimit } from "@/shared/infra/rate-limit";
import { getEffectiveUserFromContext } from "@/lib/impersonate";
import {
  executeManualAttendance,
  manualAttendanceSchema,
} from "@/features/admin-attendance/application/use-cases/handle-manual-attendance";
import {
  createAdminInviteSchema,
  executeCreateAdminInviteLink,
} from "@/features/user-management/application/use-cases/create-admin-invite-link";
import {
  absenceJustificationSchema,
  executeSaveAbsenceJustification,
} from "@/features/scheduling/application/use-cases/save-absence-justification";
import { executeUpdateAssignmentStatus } from "@/features/scheduling/application/use-cases/update-assignment-status";

export type ManualAttendanceResult =
  | { success: true; data: { leaderNotificationsSent?: number } }
  | { success: false; error: string };

export async function manualAttendanceAction(input: unknown): Promise<ManualAttendanceResult> {
  const session = await auth();
  const sessionUser = session?.user as { id?: string; name?: string | null; role?: string } | undefined;

  if (!canRecordManualAttendance(session)) {
    return { success: false, error: "Sem permissão" };
  }

  // Lançar falta dispara aviso no Telegram para os líderes. Mesmo teto do
  // /api/attendance/validate, para o botão da grade não virar disparador.
  if (!checkRateLimit(`manual-attendance:${sessionUser?.id ?? "anon"}`)) {
    return { success: false, error: "Muitas ações seguidas. Aguarde 1 minuto." };
  }

  const parsed = manualAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Dados inválidos" };
  }

  try {
    const result = await executeManualAttendance({
      actor: {
        id: sessionUser?.id ?? "",
        name: sessionUser?.name ?? null,
        role: sessionHasRole(session, "COORDINATOR") ? "COORDINATOR" : "PRECEPTOR",
      },
      input: parsed.data,
    });

    revalidatePath("/admin");
    revalidatePath("/preceptor");

    if (!result.body.success) {
      return { success: false, error: result.body.error ?? "Falha ao processar" };
    }
    return { success: true, data: result.body.data ?? {} };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Falha interna ao processar presença manual",
    };
  }
}

export type CreateInviteLinkResult =
  | { success: true; data: { url: string } }
  | { success: false; error: string };

export async function createInviteLinkAction(input: unknown): Promise<CreateInviteLinkResult> {
  const session = await auth();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;

  if (!sessionUser || sessionUser.role !== "COORDINATOR") {
    return { success: false, error: "Sem permissão" };
  }

  const parsed = createAdminInviteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    const result = await executeCreateAdminInviteLink({
      actorUserId: sessionUser.id ?? "",
      input: parsed.data,
      authUrl: process.env.AUTH_URL,
    });
    if (!result.body.success) {
      return { success: false, error: result.body.error ?? "Falha ao gerar link" };
    }
    return { success: true, data: result.body.data };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("created_by") || (typeof (err as Record<string, unknown>).code === "string" && (err as Record<string, unknown>).code === "23503")) {
      return { success: false, error: "Sessão inválida. Faça logout e login novamente." };
    }
    return { success: false, error: msg || "Falha ao gerar link" };
  }
}

export type SaveAbsenceJustificationResult =
  | { success: true; data: { absenceJustification: string | null; absenceJustificationActor: string | null; absenceJustificationAt: string | null } }
  | { success: false; error: string };

export async function saveAbsenceJustificationAction(
  assignmentId: string,
  input: unknown,
): Promise<SaveAbsenceJustificationResult> {
  const user = await getEffectiveUserFromContext();
  if (!user || !["COORDINATOR", "LEADER", "INTERN"].includes(user.role)) {
    return { success: false, error: "Sem permissão" };
  }

  const parsed = absenceJustificationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Justificativa inválida" };
  }

  try {
    const result = await executeSaveAbsenceJustification({
      actor: {
        id: user.id,
        role: user.role,
        facultyId: user.facultyId,
        isImpersonating: user.isImpersonating,
        realUserId: user.realUserId,
      },
      assignmentId,
      input: parsed.data,
    });
    if (!result.body.success) {
      return { success: false, error: result.body.error ?? "Falha ao salvar" };
    }
    const data = result.body.data;
    return {
      success: true,
      data: {
        absenceJustification: data.absenceJustification ?? null,
        absenceJustificationActor: data.absenceJustificationActor ?? null,
        absenceJustificationAt: data.absenceJustificationAt
          ? new Date(data.absenceJustificationAt).toISOString()
          : null,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao salvar justificativa",
    };
  }
}

export type DismissAbsenceAlertResult = { success: true } | { success: false; error: string };

export async function dismissAbsenceAlertAction(assignmentId: string): Promise<DismissAbsenceAlertResult> {
  const session = await auth();
  const sessionUser = session?.user as { id?: string; role?: string } | undefined;

  if (!sessionUser || sessionUser.role !== "COORDINATOR") {
    return { success: false, error: "Sem permissão" };
  }
  if (!assignmentId) {
    return { success: false, error: "ID obrigatório" };
  }

  const updated = await db
    .update(assignments)
    .set({
      absenceAlertDismissedAt: new Date(),
      absenceAlertDismissedBy: sessionUser.id ?? "",
    })
    .where(and(
      eq(assignments.id, assignmentId),
      eq(assignments.status, "ABSENT"),
      isNull(assignments.absenceAlertDismissedAt),
    ))
    .returning({ id: assignments.id });

  if (updated.length === 0) {
    return { success: false, error: "Falta não encontrada ou já dispensada" };
  }

  const actorId = sessionUser.id ?? "";
  after(() => logAudit({
    userId: actorId,
    action: "ABSENCE_ALERT_DISMISSED",
    entity: "assignment",
    entityId: assignmentId,
    payload: {},
  }));

  revalidatePath("/admin");
  return { success: true };
}

export type CancelAssignmentResult = { success: true } | { success: false; error: string };

export async function cancelAssignmentAction(assignmentId: string, notes?: string): Promise<CancelAssignmentResult> {
  const user = await getEffectiveUserFromContext();
  if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
    return { success: false, error: "Sem permissão" };
  }

  try {
    const result = await executeUpdateAssignmentStatus({
      actor: {
        id: user.id,
        role: user.role,
        facultyId: user.facultyId,
        isImpersonating: user.isImpersonating,
        realUserId: user.realUserId,
      },
      input: {
        id: assignmentId,
        status: "CANCELLED",
        notes,
      },
    });

    if (!result.body.success) {
      return { success: false, error: result.body.error ?? "Falha ao cancelar" };
    }

    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao cancelar plantão",
    };
  }
}
