import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { bases, faculties, inviteLinks, userPhotoChangeRequests, userRoles, users } from "@/shared/db/schema";

export async function listFacultyInternRows(facultyId: string, cohortId?: string | null) {
  const conditions = [
    eq(userRoles.facultyId, facultyId),
    ...(cohortId ? [eq(userRoles.cohortId, cohortId)] : []),
  ];

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      userActive: users.isActive,
      roleActive: userRoles.isActive,
      isArchived: userRoles.isArchived,
    })
    .from(users)
    .innerJoin(
      userRoles,
      and(eq(userRoles.userId, users.id), eq(userRoles.role, "INTERN")),
    )
    .where(and(...conditions))
    .orderBy(users.name);

  return rows;
}

export async function updateInternArchiveStatus(params: {
  userId: string;
  facultyId: string;
  isArchived: boolean;
  archivedBy: string | null;
}) {
  await db
    .update(userRoles)
    .set({
      isArchived: params.isArchived,
      archivedAt: params.isArchived ? new Date() : null,
      archivedBy: params.isArchived ? params.archivedBy : null,
    })
    .where(
      and(
        eq(userRoles.userId, params.userId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.facultyId, params.facultyId),
      ),
    );
}

export async function updateInternRoleActiveStatus(params: {
  userId: string;
  facultyId: string;
  isActive: boolean;
}) {
  await db
    .update(userRoles)
    .set({ isActive: params.isActive })
    .where(
      and(
        eq(userRoles.userId, params.userId),
        eq(userRoles.role, "INTERN"),
        eq(userRoles.facultyId, params.facultyId),
      ),
    );
}

export async function listPendingUsersRows() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      cpf: users.cpf,
      email: users.email,
      phone: users.phone,
      isActive: users.isActive,
      createdAt: users.createdAt,
      role: userRoles.role,
      facultyId: userRoles.facultyId,
      facultyAbbr: faculties.abbreviation,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(faculties, eq(faculties.id, userRoles.facultyId))
    .where(eq(users.isActive, false))
    .orderBy(users.createdAt);

  return rows;
}

export async function findUserRoleFaculty(userId: string) {
  const [role] = await db
    .select({ facultyId: userRoles.facultyId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .limit(1);

  return role;
}

export async function findPendingPhotoChangeRequestByUserId(userId: string) {
  const [request] = await db
    .select({
      id: userPhotoChangeRequests.id,
      requestedSelfie: userPhotoChangeRequests.requestedSelfie,
      requestedAt: userPhotoChangeRequests.requestedAt,
      status: userPhotoChangeRequests.status,
    })
    .from(userPhotoChangeRequests)
    .where(and(
      eq(userPhotoChangeRequests.userId, userId),
      eq(userPhotoChangeRequests.status, "PENDING"),
    ))
    .orderBy(desc(userPhotoChangeRequests.requestedAt))
    .limit(1);

  return request;
}

export async function createOrReplacePhotoChangeRequest(params: {
  userId: string;
  facultyId: string | null;
  currentSelfie: string | null;
  requestedSelfie: string;
}) {
  const now = new Date();
  const existing = await findPendingPhotoChangeRequestByUserId(params.userId);

  if (existing) {
    const [updated] = await db
      .update(userPhotoChangeRequests)
      .set({
        facultyId: params.facultyId,
        currentSelfie: params.currentSelfie,
        requestedSelfie: params.requestedSelfie,
        requestedAt: now,
        updatedAt: now,
        reviewNotes: null,
        reviewedAt: null,
        reviewedBy: null,
      })
      .where(eq(userPhotoChangeRequests.id, existing.id))
      .returning({
        id: userPhotoChangeRequests.id,
        requestedSelfie: userPhotoChangeRequests.requestedSelfie,
        requestedAt: userPhotoChangeRequests.requestedAt,
        status: userPhotoChangeRequests.status,
      });

    return updated;
  }

  const [created] = await db
    .insert(userPhotoChangeRequests)
    .values({
      userId: params.userId,
      facultyId: params.facultyId,
      currentSelfie: params.currentSelfie,
      requestedSelfie: params.requestedSelfie,
      requestedAt: now,
      updatedAt: now,
    })
    .returning({
      id: userPhotoChangeRequests.id,
      requestedSelfie: userPhotoChangeRequests.requestedSelfie,
      requestedAt: userPhotoChangeRequests.requestedAt,
      status: userPhotoChangeRequests.status,
    });

  return created;
}

export async function listPendingPhotoChangeRequestsRows() {
  return db
    .select({
      id: userPhotoChangeRequests.id,
      userId: users.id,
      userName: users.name,
      email: users.email,
      facultyId: userPhotoChangeRequests.facultyId,
      facultyAbbr: faculties.abbreviation,
      currentSelfie: userPhotoChangeRequests.currentSelfie,
      requestedSelfie: userPhotoChangeRequests.requestedSelfie,
      requestedAt: userPhotoChangeRequests.requestedAt,
      status: userPhotoChangeRequests.status,
    })
    .from(userPhotoChangeRequests)
    .innerJoin(users, eq(users.id, userPhotoChangeRequests.userId))
    .leftJoin(faculties, eq(faculties.id, userPhotoChangeRequests.facultyId))
    .where(eq(userPhotoChangeRequests.status, "PENDING"))
    .orderBy(userPhotoChangeRequests.requestedAt);
}

export async function findPhotoChangeRequestForReview(requestId: string) {
  const [request] = await db
    .select({
      id: userPhotoChangeRequests.id,
      userId: userPhotoChangeRequests.userId,
      facultyId: userPhotoChangeRequests.facultyId,
      requestedSelfie: userPhotoChangeRequests.requestedSelfie,
      status: userPhotoChangeRequests.status,
    })
    .from(userPhotoChangeRequests)
    .where(eq(userPhotoChangeRequests.id, requestId))
    .limit(1);

  return request;
}

export async function reviewPhotoChangeRequest(params: {
  requestId: string;
  status: "APPROVED" | "REJECTED";
  reviewedBy: string;
  reviewNotes?: string | null;
}) {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select({
        id: userPhotoChangeRequests.id,
        userId: userPhotoChangeRequests.userId,
        requestedSelfie: userPhotoChangeRequests.requestedSelfie,
        status: userPhotoChangeRequests.status,
      })
      .from(userPhotoChangeRequests)
      .where(eq(userPhotoChangeRequests.id, params.requestId))
      .limit(1);

    if (!request) return null;

    if (request.status !== "PENDING") {
      return { id: request.id, userId: request.userId, status: request.status };
    }

    const [updated] = await tx
      .update(userPhotoChangeRequests)
      .set({
        status: params.status,
        reviewedAt: now,
        reviewedBy: params.reviewedBy,
        reviewNotes: params.reviewNotes ?? null,
        updatedAt: now,
      })
      .where(eq(userPhotoChangeRequests.id, params.requestId))
      .returning({
        id: userPhotoChangeRequests.id,
        userId: userPhotoChangeRequests.userId,
        status: userPhotoChangeRequests.status,
      });

    if (params.status === "APPROVED") {
      await tx
        .update(users)
        .set({
          selfie: request.requestedSelfie,
          selfieUploadedAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, request.userId));
    }

    return updated;
  });
}

export async function approvePendingUser(userId: string) {
  await db.update(users).set({ isActive: true, updatedAt: new Date() }).where(eq(users.id, userId));
}

export async function rejectPendingUser(userId: string) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

export async function listInviteLinks(createdBy?: string) {
  const query = db
    .select({
      id: inviteLinks.id,
      token: inviteLinks.token,
      facultyId: inviteLinks.facultyId,
      facultyAbbr: faculties.abbreviation,
      isActive: inviteLinks.isActive,
      expiresAt: inviteLinks.expiresAt,
      createdAt: inviteLinks.createdAt,
    })
    .from(inviteLinks)
    .leftJoin(faculties, eq(faculties.id, inviteLinks.facultyId));

  if (createdBy) {
    return query.where(eq(inviteLinks.createdBy, createdBy)).orderBy(inviteLinks.createdAt);
  }

  return query.orderBy(inviteLinks.createdAt);
}

export async function createInviteLink(params: {
  token: string;
  targetRole: string;
  createdBy: string;
  facultyId: string | null;
  baseId?: string | null;
  cohortId?: string | null;
  expiresAt: Date;
}) {
  const [link] = await db.insert(inviteLinks).values({
    token: params.token,
    targetRole: params.targetRole,
    createdBy: params.createdBy,
    facultyId: params.facultyId,
    baseId: params.baseId ?? null,
    cohortId: params.cohortId ?? null,
    expiresAt: params.expiresAt,
  }).returning();

  return link;
}

export async function findFacultyById(id: string) {
  const [faculty] = await db.select({ id: faculties.id }).from(faculties).where(eq(faculties.id, id)).limit(1);
  return faculty;
}

export async function findBaseById(id: string) {
  const [base] = await db.select({ id: bases.id }).from(bases).where(eq(bases.id, id)).limit(1);
  return base;
}

export async function deactivateInviteLink(params: {
  linkId: string;
  createdBy?: string;
}) {
  const conditions = params.createdBy
    ? and(eq(inviteLinks.id, params.linkId), eq(inviteLinks.createdBy, params.createdBy))
    : eq(inviteLinks.id, params.linkId);

  const [updated] = await db
    .update(inviteLinks)
    .set({ isActive: false })
    .where(conditions)
    .returning();

  return updated;
}
