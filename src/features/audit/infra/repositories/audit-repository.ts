import { desc, eq } from "drizzle-orm";
import { db } from "@/shared/db/client";
import { auditLog, users } from "@/shared/db/schema";

export async function listRecentAuditRows() {
  return db
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      userName: users.name,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      payload: auditLog.payload,
      ipAddress: auditLog.ipAddress,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.userId, users.id))
    .orderBy(desc(auditLog.createdAt))
    .limit(500);
}
