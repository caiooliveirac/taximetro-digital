import { and, eq } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { bases, faculties, inviteLinks, userRoles, users } from "@/shared/db/schema";

export async function findValidInviteByToken(token: string) {
  const [invite] = await db
    .select({
      id: inviteLinks.id,
      targetRole: inviteLinks.targetRole,
      facultyId: inviteLinks.facultyId,
      facultyName: faculties.name,
      facultyAbbr: faculties.abbreviation,
      baseId: inviteLinks.baseId,
      baseCode: bases.code,
      baseName: bases.name,
      cohortId: inviteLinks.cohortId,
      isActive: inviteLinks.isActive,
      expiresAt: inviteLinks.expiresAt,
    })
    .from(inviteLinks)
    .leftJoin(faculties, eq(faculties.id, inviteLinks.facultyId))
    .leftJoin(bases, eq(bases.id, inviteLinks.baseId))
    .where(and(eq(inviteLinks.token, token), eq(inviteLinks.isActive, true)));

  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt < new Date()) return null;
  return invite;
}

export async function findUserByCpf(cpf: string) {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.cpf, cpf)).limit(1);
  return user;
}

export async function findUserByEmail(email: string) {
  const [user] = await db.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function createPendingUser(params: {
  name: string;
  cpf: string | null;
  email: string;
  phone: string;
  passwordHash: string;
  selfie: string;
}) {
  const [user] = await db.insert(users).values({
    name: params.name,
    cpf: params.cpf,
    email: params.email,
    phone: params.phone,
    passwordHash: params.passwordHash,
    selfie: params.selfie,
    selfieUploadedAt: new Date(),
    isActive: false,
  }).returning();

  return user;
}

export async function createUserRole(params: {
  userId: string;
  role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
  facultyId: string | null;
  baseId: string | null;
  cohortId?: string | null;
}) {
  await db.insert(userRoles).values({
    userId: params.userId,
    role: params.role,
    facultyId: params.facultyId,
    baseId: params.baseId,
    cohortId: params.cohortId ?? null,
  });
}
