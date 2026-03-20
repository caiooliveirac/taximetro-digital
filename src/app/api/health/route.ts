import { db } from "@/db";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const dbMs = Date.now() - start;

    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      db: { connected: true, latencyMs: dbMs },
    });
  } catch {
    return NextResponse.json(
      { status: "unhealthy", timestamp: new Date().toISOString(), db: { connected: false } },
      { status: 503 },
    );
  }
}
