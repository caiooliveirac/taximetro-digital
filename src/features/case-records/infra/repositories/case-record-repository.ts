import { and, eq, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { caseRecords } from "@/shared/db/schema";

export async function listCaseRecords(params?: {
  internId?: string;
  assignmentId?: string;
}) {
  const conditions = [];
  if (params?.internId) conditions.push(eq(caseRecords.internId, params.internId));
  if (params?.assignmentId) conditions.push(eq(caseRecords.assignmentId, params.assignmentId));

  let query = db.select().from(caseRecords).orderBy(caseRecords.createdAt).$dynamic();
  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }
  return query;
}

export async function countCaseRecordsForAssignment(assignmentId: string) {
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(caseRecords)
    .where(eq(caseRecords.assignmentId, assignmentId));

  return countResult?.count ?? 0;
}

export async function createCaseRecord(params: {
  assignmentId: string;
  internId: string;
  caseNumber: string;
  nickname: string;
  description: string | null;
}) {
  const [created] = await db.insert(caseRecords).values({
    assignmentId: params.assignmentId,
    internId: params.internId,
    caseNumber: params.caseNumber,
    nickname: params.nickname,
    description: params.description,
  }).returning();

  return created;
}
