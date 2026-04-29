import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { assignments, bases, checkins, requests, userRoles, users } from "@/shared/db/schema";
import { alias } from "drizzle-orm/pg-core";

export async function listRequestsRows() {
  const targetUser = alias(users, "target_user");
  const targetAssign = alias(assignments, "target_assign");
  const targetBase = alias(bases, "target_base");
  const extraBase = alias(bases, "extra_base");

  const rows = await db
    .select({
      id: requests.id,
      type: requests.type,
      requesterId: requests.requesterId,
      requesterName: users.name,
      assignmentId: requests.assignmentId,
      assignmentDate: assignments.date,
      assignmentPeriod: assignments.period,
      baseCode: bases.code,
      baseName: bases.name,
      baseType: bases.type,
      facultyId: assignments.facultyId,
      targetInternId: requests.targetInternId,
      targetInternName: targetUser.name,
      targetAssignmentId: requests.targetAssignmentId,
      targetAssignmentDate: targetAssign.date,
      targetAssignmentPeriod: targetAssign.period,
      targetBaseCode: targetBase.code,
      targetBaseName: targetBase.name,
      extraBaseId: requests.extraBaseId,
      extraBaseCode: extraBase.code,
      extraBaseName: extraBase.name,
      extraDate: requests.extraDate,
      extraPeriod: requests.extraPeriod,
      status: requests.status,
      reviewNotes: requests.reviewNotes,
      createdAt: requests.createdAt,
    })
    .from(requests)
    .innerJoin(users, eq(users.id, requests.requesterId))
    .leftJoin(assignments, eq(assignments.id, requests.assignmentId))
    .leftJoin(bases, eq(bases.id, assignments.baseId))
    .leftJoin(targetUser, eq(targetUser.id, requests.targetInternId))
    .leftJoin(targetAssign, eq(targetAssign.id, requests.targetAssignmentId))
    .leftJoin(targetBase, eq(targetBase.id, targetAssign.baseId))
    .leftJoin(extraBase, eq(extraBase.id, requests.extraBaseId))
    .orderBy(requests.createdAt);

  return rows;
}

export async function listCompletedSwapRows() {
  const requesterUser = alias(users, "requester_user");
  const targetUser = alias(users, "target_user");
  const origAssign = alias(assignments, "orig_assign");
  const origBase = alias(bases, "orig_base");
  const targetAssign = alias(assignments, "target_assign");
  const targetBase = alias(bases, "target_base");

  const rows = await db
    .select({
      id: requests.id,
      status: requests.status,
      createdAt: requests.createdAt,
      reviewedAt: requests.reviewedAt,
      requesterId: requests.requesterId,
      requesterName: requesterUser.name,
      origAssignmentId: origAssign.id,
      origDate: origAssign.date,
      origPeriod: origAssign.period,
      origShift: origAssign.shift,
      origBaseCode: origBase.code,
      origBaseName: origBase.name,
      origStatus: origAssign.status,
      targetInternId: requests.targetInternId,
      targetInternName: targetUser.name,
      targetAssignmentId: targetAssign.id,
      targetDate: targetAssign.date,
      targetPeriod: targetAssign.period,
      targetShift: targetAssign.shift,
      targetBaseCode: targetBase.code,
      targetBaseName: targetBase.name,
      targetStatus: targetAssign.status,
    })
    .from(requests)
    .innerJoin(requesterUser, eq(requesterUser.id, requests.requesterId))
    .leftJoin(origAssign, eq(origAssign.id, requests.assignmentId))
    .leftJoin(origBase, eq(origBase.id, origAssign.baseId))
    .leftJoin(targetUser, eq(targetUser.id, requests.targetInternId))
    .leftJoin(targetAssign, eq(targetAssign.id, requests.targetAssignmentId))
    .leftJoin(targetBase, eq(targetBase.id, targetAssign.baseId))
    .where(and(
      eq(requests.type, "SWAP"),
      eq(requests.status, "COMPLETED"),
    ))
    .orderBy(desc(requests.reviewedAt));

  return rows;
}

export async function findFacultyInternIds(facultyId: string) {
  const facultyInterns = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(and(eq(userRoles.role, "INTERN"), eq(userRoles.facultyId, facultyId), eq(userRoles.isActive, true)));

  return new Set(facultyInterns.map((r) => r.userId));
}

export async function findAssignmentOwnerBasic(assignmentId: string) {
  const [ownerAssignment] = await db
    .select({ id: assignments.id, internId: assignments.internId, status: assignments.status, date: assignments.date, isExtraShift: assignments.isExtraShift })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  return ownerAssignment;
}

export async function findPendingRequestByAssignment(assignmentId: string) {
  const [existingReq] = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(
      eq(requests.assignmentId, assignmentId),
      inArray(requests.status, ["PENDING", "OPEN"]),
    ))
    .limit(1);

  return existingReq;
}

export async function findRequesterFacultyRole(requesterId: string) {
  const [reqRole] = await db
    .select({ facultyId: userRoles.facultyId })
    .from(userRoles)
    .where(and(
      eq(userRoles.userId, requesterId),
      eq(userRoles.role, "INTERN"),
      eq(userRoles.isActive, true),
    ))
    .limit(1);

  return reqRole;
}

export async function findExistingAssignmentForInternSlot(params: {
  internId: string;
  date: string;
  period: "DAY" | "NIGHT";
}) {
  const [existingAssignment] = await db
    .select({ id: assignments.id, status: assignments.status })
    .from(assignments)
    .where(and(
      eq(assignments.internId, params.internId),
      eq(assignments.date, params.date),
      eq(assignments.period, params.period),
    ))
    .limit(1);

  return existingAssignment;
}

export async function findPendingExtraRequest(params: {
  requesterId: string;
  extraDate: string;
  extraPeriod: "DAY" | "NIGHT";
}) {
  const [existingReq] = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(
      eq(requests.requesterId, params.requesterId),
      eq(requests.type, "EXTRA_SHIFT"),
      eq(requests.extraDate, params.extraDate),
      eq(requests.extraPeriod, params.extraPeriod),
      inArray(requests.status, ["PENDING", "ESCALATED"]),
    ))
    .limit(1);

  return existingReq;
}

export async function insertRequest(values: {
  type: "SWAP" | "EXTRA_SHIFT" | "DROP_SHIFT";
  requesterId: string;
  assignmentId: string | null;
  targetInternId: string | null;
  targetAssignmentId: string | null;
  extraBaseId: string | null;
  extraDate: string | null;
  extraPeriod: "DAY" | "NIGHT" | null;
  status: "OPEN" | "PENDING";
}) {
  const [created] = await db.insert(requests).values(values).returning();
  return created;
}

export async function findRequestById(id: string) {
  const [request] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
  return request;
}

export async function findAssignmentWithOwnership(assignmentId: string) {
  const [assignment] = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      status: assignments.status,
      date: assignments.date,
      facultyId: assignments.facultyId,
    })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  return assignment;
}

export async function findAssignmentFaculty(assignmentId: string) {
  const [assignment] = await db
    .select({ facultyId: assignments.facultyId })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);

  return assignment;
}

export async function updateRequestProposal(params: {
  requestId: string;
  targetInternId: string;
  targetAssignmentId: string;
}) {
  await db.update(requests).set({
    targetInternId: params.targetInternId,
    targetAssignmentId: params.targetAssignmentId,
    status: "PENDING",
  }).where(eq(requests.id, params.requestId));
}

export async function findAssignmentById(assignmentId: string) {
  const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
  return assignment;
}

export async function hasCheckinRecord(assignmentId: string) {
  const [checkin] = await db
    .select({ id: checkins.id })
    .from(checkins)
    .where(eq(checkins.assignmentId, assignmentId))
    .limit(1);

  return Boolean(checkin);
}

export async function cancelAssignmentForSwap(assignmentId: string) {
  await db.update(assignments).set({ status: "CANCELLED", updatedAt: new Date(), notes: "Trocado via solicitação" }).where(eq(assignments.id, assignmentId));
}

export async function createSwapAssignment(params: {
  internId: string;
  facultyId: string;
  baseId: string;
  date: string;
  period: "DAY" | "NIGHT";
  createdBy: string;
}) {
  await db.insert(assignments).values({
    internId: params.internId,
    facultyId: params.facultyId,
    baseId: params.baseId,
    date: params.date,
    period: params.period,
    createdBy: params.createdBy,
    notes: "Troca entre internos",
  });
}

export async function completeSwapRequest(requestId: string) {
  await db.update(requests).set({ status: "COMPLETED", reviewedAt: new Date(), reviewNotes: "Troca confirmada por ambas partes" }).where(eq(requests.id, requestId));
}

export async function reopenSwapRequest(requestId: string) {
  await db.update(requests).set({
    targetInternId: null,
    targetAssignmentId: null,
    status: "OPEN",
  }).where(eq(requests.id, requestId));
}

export async function cancelOpenSwapRequest(requestId: string) {
  await db.update(requests).set({ status: "CANCELLED" }).where(eq(requests.id, requestId));
}

export async function findBaseAvailability(baseId: string) {
  const [extraBaseRow] = await db
    .select({ id: bases.id, isActive: bases.isActive })
    .from(bases)
    .where(eq(bases.id, baseId))
    .limit(1);

  return extraBaseRow;
}

export async function reactivateCancelledAssignment(params: {
  assignmentId: string;
  facultyId: string;
  baseId: string;
  updatedBy: string;
}) {
  await db.update(assignments).set({
    facultyId: params.facultyId,
    baseId: params.baseId,
    status: "SCHEDULED",
    updatedAt: new Date(),
    createdBy: params.updatedBy,
    notes: "Plantão extra aprovado",
  }).where(eq(assignments.id, params.assignmentId));
}

export async function createApprovedExtraAssignment(params: {
  requesterId: string;
  facultyId: string;
  baseId: string;
  date: string;
  period: "DAY" | "NIGHT";
  createdBy: string;
}) {
  await db.insert(assignments).values({
    internId: params.requesterId,
    facultyId: params.facultyId,
    baseId: params.baseId,
    date: params.date,
    period: params.period,
    createdBy: params.createdBy,
    notes: "Plantão extra aprovado",
  });
}

export async function hasCheckinForAssignment(assignmentId: string) {
  const [existingCheckin] = await db
    .select({ id: checkins.id })
    .from(checkins)
    .where(eq(checkins.assignmentId, assignmentId))
    .limit(1);

  return Boolean(existingCheckin);
}

export async function cancelAssignmentById(assignmentId: string, note: string) {
  await db
    .update(assignments)
    .set({ status: "CANCELLED", updatedAt: new Date(), notes: note })
    .where(eq(assignments.id, assignmentId));
}

export async function updateRequestReview(params: {
  id: string;
  status: string;
  reviewedBy: string;
  reviewNotes?: string;
}) {
  const [updated] = await db
    .update(requests)
    .set({
      status: params.status as "PENDING" | "APPROVED" | "REJECTED" | "ESCALATED" | "COMPLETED" | "OPEN" | "CANCELLED",
      reviewedBy: params.reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: params.reviewNotes,
    })
    .where(eq(requests.id, params.id))
    .returning();

  return updated;
}
