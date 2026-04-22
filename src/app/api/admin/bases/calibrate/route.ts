import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  calibrateBaseSchema,
  executeCalibrateBase,
} from "@/features/bases/application/use-cases/manage-admin-bases";

const ALLOWED_ROLES = ["COORDINATOR"];

export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || !ALLOWED_ROLES.includes(token.role as string)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = calibrateBaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
  }

  const result = await executeCalibrateBase({
    actorUserId: token.id as string,
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
