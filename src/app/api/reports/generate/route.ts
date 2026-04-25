import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { z } from "zod";
import { reportFilterInputSchema } from "@/lib/report-filters";

export const dynamic = "force-dynamic";

async function parsePayload(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => null);
    const parsed = z.object({ filters: reportFilterInputSchema }).safeParse(body);
    if (!parsed.success) {
      return { success: false as const, response: NextResponse.json({ success: false, error: "Payload inválido", details: parsed.error.flatten() }, { status: 400 }) };
    }
    return { success: true as const, filters: parsed.data.filters };
  }

  return { success: false as const, response: NextResponse.json({ success: false, error: "Use application/json nesta rota" }, { status: 415 }) };
}

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const parsed = await parsePayload(req);
  if (!parsed.success) return parsed.response;

  const { document, exportBaseName } = await generateAdminReport(parsed.filters);
  return NextResponse.json({ success: true, data: { document, exportBaseName } }, { headers: { "cache-control": "no-store" } });
}