import { eq, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { caseRecords } from "@/shared/db/schema";

export async function listCaseRecords() {
  return db.select().from(caseRecords).orderBy(caseRecords.createdAt);
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
