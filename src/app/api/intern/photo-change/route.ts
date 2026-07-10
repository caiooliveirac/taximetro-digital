import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getEffectiveUser } from "@/lib/impersonate";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  createOrReplacePhotoChangeRequest,
  findPendingPhotoChangeRequestByUserId,
} from "@/features/user-management/infra/repositories/user-management-repository";

const createPhotoChangeSchema = z.object({
  selfie: z.string().min(1),
});

async function loadPayload(userId: string) {
  const [user] = await db
    .select({ selfie: users.selfie })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const pendingRequest = await findPendingPhotoChangeRequestByUserId(userId);

  return {
    currentSelfie: user?.selfie ?? null,
    pendingRequest: pendingRequest ?? null,
  };
}

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const data = await loadPayload(user.id);
  return NextResponse.json({ success: true, data });
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  if (!user.facultyId) {
    return NextResponse.json({ success: false, error: "Seu cadastro não tem faculdade vinculada" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = createPhotoChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const [currentUser] = await db
    .select({ selfie: users.selfie })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  await createOrReplacePhotoChangeRequest({
    userId: user.id,
    facultyId: user.facultyId,
    currentSelfie: currentUser?.selfie ?? null,
    requestedSelfie: parsed.data.selfie,
  });

  await logAudit({
    userId: user.realUserId ?? user.id,
    action: "REQUEST_PHOTO_CHANGE",
    entity: "user",
    entityId: user.id,
  });

  const data = await loadPayload(user.id);
  return NextResponse.json({ success: true, data });
}