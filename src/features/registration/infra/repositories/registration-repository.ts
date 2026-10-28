import { and, eq, gte, inArray, max, or } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, bases, cohorts, faculties, inviteLinks, telegramBindings, userRoles, users } from "@/shared/db/schema";
import { emailDeContaArquivada, type ContaExistente } from "@/features/registration/domain/recadastro";

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
      createdBy: inviteLinks.createdBy,
      isActive: inviteLinks.isActive,
    })
    .from(inviteLinks)
    .leftJoin(faculties, eq(faculties.id, inviteLinks.facultyId))
    .leftJoin(bases, eq(bases.id, inviteLinks.baseId))
    .where(and(eq(inviteLinks.token, token), eq(inviteLinks.isActive, true)));

  // Convite não expira: só deixa de valer quando é desativado. Turma que já
  // fechou não trava o link — o cadastro cai na turma aberta da faculdade.
  return invite ?? null;
}

/** Contas que já ocupam o e-mail ou o CPF do cadastro (podem ser duas). */
export async function findUsersByEmailOrCpf(email: string, cpf: string | null) {
  return db
    .select({ id: users.id, name: users.name, email: users.email, cpf: users.cpf, isActive: users.isActive })
    .from(users)
    .where(cpf ? or(eq(users.email, email), eq(users.cpf, cpf)) : eq(users.email, email));
}

export async function loadContaExistente(userId: string, today: string): Promise<ContaExistente> {
  const roles = await db
    .select({ role: userRoles.role, cohortStatus: cohorts.status, isActive: userRoles.isActive })
    .from(userRoles)
    .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
    .where(eq(userRoles.userId, userId));
  const [pendente] = await db
    .select({ ate: max(assignments.date) })
    .from(assignments)
    .where(and(
      eq(assignments.internId, userId),
      gte(assignments.date, today),
      inArray(assignments.status, ["SCHEDULED", "CONFIRMED", "CHECKED_IN"]),
    ));
  return { roles, ultimoPlantaoPendente: pendente?.ate ?? null };
}

/**
 * Tira a conta do ar e libera e-mail, CPF, Google e Telegram para o cadastro
 * novo. Plantões, check-ins e papéis ficam na conta antiga (papéis arquivados).
 */
export async function arquivarContaParaRecadastro(userId: string) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [binding] = await tx.delete(telegramBindings).where(eq(telegramBindings.userId, userId)).returning();
    await tx.update(userRoles)
      .set({ isActive: false, isArchived: true, archivedAt: now })
      .where(eq(userRoles.userId, userId));
    await tx.update(users).set({
      isActive: false,
      email: emailDeContaArquivada(userId),
      cpf: null,
      googleId: null,
      updatedAt: now,
    }).where(eq(users.id, userId));
    return { telegramUserId: binding?.telegramUserId ?? null, telegramName: binding?.telegramName ?? null };
  });
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
