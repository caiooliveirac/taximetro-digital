import { db } from "@/shared/db/client";
import { auditLog } from "@/shared/db/schema";

export async function logAudit(opts: {
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
  realUserId?: string;
}) {
  const payload = opts.realUserId
    ? { realUserId: opts.realUserId, ...opts.payload }
    : (opts.payload ?? null);

  await db.insert(auditLog).values({
    userId: opts.userId ?? null,
    action: opts.action,
    entity: opts.entity ?? null,
    entityId: opts.entityId ?? null,
    payload,
    ipAddress: opts.ipAddress ?? null,
  });
}
