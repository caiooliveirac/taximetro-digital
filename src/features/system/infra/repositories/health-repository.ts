import { sql } from "drizzle-orm";
import { db } from "@/shared/db/client";

export async function pingDatabase() {
  await db.execute(sql`SELECT 1`);
}
