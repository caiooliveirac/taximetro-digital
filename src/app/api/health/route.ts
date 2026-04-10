import { NextResponse } from "next/server";
import { executeGetHealthStatus } from "@/features/system/application/use-cases/get-health-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await executeGetHealthStatus();
  return NextResponse.json(result.body, { status: result.statusCode });
}
