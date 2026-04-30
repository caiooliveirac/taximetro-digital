import { randomBytes } from "crypto";
import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  createInviteLink,
  findBaseById,
  findFacultyById,
} from "@/features/user-management/infra/repositories/user-management-repository";

const VALID_ROLES = ["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"] as const;

export const createAdminInviteSchema = z.object({
  targetRole: z.enum(VALID_ROLES),
  facultyId: z.string().uuid().optional(),
  baseId: z.string().uuid().optional(),
  cohortId: z.string().uuid().optional(),
}).refine(
  (data) => {
    if (data.targetRole === "INTERN" || data.targetRole === "LEADER") return Boolean(data.facultyId);
    return true;
  },
  { message: "Faculdade obrigatória para Interno/Líder" },
);

export async function executeCreateAdminInviteLink(params: {
  actorUserId: string;
  input: z.infer<typeof createAdminInviteSchema>;
  authUrl?: string;
}) {
  const { targetRole, facultyId, baseId, cohortId } = params.input;
  const normalizedFacultyId = targetRole === "INTERN" || targetRole === "LEADER" ? (facultyId ?? null) : null;
  const normalizedBaseId = targetRole === "PRECEPTOR" ? null : (baseId ?? null);
  const normalizedCohortId = targetRole === "INTERN" ? (cohortId ?? null) : null;

  if (normalizedFacultyId) {
    const faculty = await findFacultyById(normalizedFacultyId);
    if (!faculty) {
      return { status: 400, body: { success: false, error: "Faculdade não encontrada" } } as const;
    }
  }

  if (normalizedBaseId) {
    const base = await findBaseById(normalizedBaseId);
    if (!base) {
      return { status: 400, body: { success: false, error: "Base não encontrada" } } as const;
    }
  }

  const link = await createInviteLink({
    token: randomBytes(16).toString("base64url"),
    targetRole,
    createdBy: params.actorUserId,
    facultyId: normalizedFacultyId,
    baseId: normalizedBaseId,
    cohortId: normalizedCohortId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  await logAudit({
    userId: params.actorUserId,
    action: "CREATE_INVITE",
    entity: "invite_link",
    entityId: link.id,
    payload: { targetRole, facultyId: normalizedFacultyId, baseId: normalizedBaseId, cohortId: normalizedCohortId },
  });

  const baseUrl = (params.authUrl ?? "https://mnrs.com.br").replace(/\/$/, "");

  return {
    status: 201,
    body: {
      success: true,
      data: {
        id: link.id,
        token: link.token,
        targetRole,
        url: `${baseUrl}/taximetro/registro/${link.token}`,
        expiresAt: link.expiresAt,
      },
    },
  } as const;
}
