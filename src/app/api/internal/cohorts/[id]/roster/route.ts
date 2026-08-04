import { NextRequest, NextResponse } from "next/server";
import { db } from "@/shared/db/client";
import { userRoles, users } from "@/db/schema";
import { eq } from "drizzle-orm";

function requireImportSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.CROSS_APP_IMPORT_SECRET;
  const got = req.headers.get("x-import-secret");
  if (!expected || !got || got !== expected) {
    return NextResponse.json({ success: false, error: "Não autorizado" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireImportSecret(req);
  if (denied) return denied;

  const { id } = await params;

  const rows = await db
    .select({
      role: userRoles.role,
      name: users.name,
      cpf: users.cpf,
      email: users.email,
      phone: users.phone,
      passwordHash: users.passwordHash,
      forcePasswordChange: users.forcePasswordChange,
    })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(eq(userRoles.cohortId, id));

  return NextResponse.json({ success: true, data: rows });
}
