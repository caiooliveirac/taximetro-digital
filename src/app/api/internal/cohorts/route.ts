import { NextRequest, NextResponse } from "next/server";
import { db } from "@/shared/db/client";
import { cohorts, faculties } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Rota servidor-a-servidor: outra instância (Vitalmed) lista turmas daqui pra
 * montar o picker de importação. Sem sessão de usuário — autenticada por
 * secret compartilhado, não por login.
 */
function requireImportSecret(req: NextRequest): NextResponse | null {
  const expected = process.env.CROSS_APP_IMPORT_SECRET;
  const got = req.headers.get("x-import-secret");
  if (!expected || !got || got !== expected) {
    return NextResponse.json({ success: false, error: "Não autorizado" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = requireImportSecret(req);
  if (denied) return denied;

  const facultyAbbreviation = req.nextUrl.searchParams.get("facultyAbbreviation");
  if (!facultyAbbreviation) {
    return NextResponse.json({ success: false, error: "facultyAbbreviation é obrigatório" }, { status: 400 });
  }

  const rows = await db
    .select({
      id: cohorts.id,
      label: cohorts.label,
      rotationNumber: cohorts.rotationNumber,
      startDate: cohorts.startDate,
      endDate: cohorts.endDate,
      status: cohorts.status,
    })
    .from(cohorts)
    .innerJoin(faculties, eq(cohorts.facultyId, faculties.id))
    .where(eq(faculties.abbreviation, facultyAbbreviation));

  return NextResponse.json({ success: true, data: rows });
}
