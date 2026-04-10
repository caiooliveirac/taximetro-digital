import { randomBytes } from "crypto";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  createInviteLink,
  deactivateInviteLink,
  listInviteLinks,
} from "@/features/user-management/infra/repositories/user-management-repository";

type Actor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

export async function executeListInviteLinks(actor: Actor) {
  const createdBy = actor.role === "LEADER" ? actor.id : undefined;
  return listInviteLinks(createdBy);
}

export async function executeCreateInviteLink(params: {
  actor: Actor;
  input: {
    targetRole?: string;
    facultyId?: string;
  };
}) {
  const { actor, input } = params;
  const targetRole = input.targetRole || "INTERN";
  const facultyId = actor.role === "LEADER" ? actor.facultyId : input.facultyId;

  if (!facultyId) {
    return { status: 400, body: { success: false, error: "facultyId obrigatório" } } as const;
  }

  const link = await createInviteLink({
    token: randomBytes(12).toString("base64url"),
    targetRole,
    createdBy: actor.realUserId ?? actor.id,
    facultyId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  await logAudit({
    userId: actor.realUserId ?? actor.id,
    action: "CREATE_INVITE",
    entity: "invite_link",
    entityId: link.id,
    payload: { targetRole, facultyId, ...(actor.isImpersonating ? { impersonating: actor.id } : {}) },
  });

  return { status: 201, body: { success: true, data: link } } as const;
}

export async function executeDeactivateInviteLink(params: {
  actor: Actor;
  linkId: string;
}) {
  const updated = await deactivateInviteLink({
    linkId: params.linkId,
    createdBy: params.actor.role === "LEADER" ? params.actor.id : undefined,
  });

  if (!updated) {
    return { status: 404, body: { success: false, error: "Link não encontrado" } } as const;
  }

  await logAudit({
    userId: params.actor.realUserId ?? params.actor.id,
    action: "DEACTIVATE_INVITE",
    entity: "invite_link",
    entityId: params.linkId,
  });

  return { status: 200, body: { success: true } } as const;
}
