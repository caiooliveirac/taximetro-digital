import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bases, userRoles, users } from "@/db/schema";


/**
 * Lista os preceptores ativos para o checkout manual: quem confirma o checkout
 * de um plantão passado é o preceptor que estava na base, não o coordenador que
 * clicou dias depois. O `baseId` de cada um permite a tela sugerir primeiro os
 * da base do plantão.
 */
export async function GET(req: NextRequest) {
  // Só o coordenador: é ele quem abre o diálogo de checkout manual, e a lista
  // expõe nome e base de todo o corpo de preceptores.
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
  if (!token || token.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const rows = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      baseId: userRoles.baseId,
      baseCode: bases.code,
    })
    .from(userRoles)
    .innerJoin(users, and(eq(users.id, userRoles.userId), eq(users.isActive, true)))
    .leftJoin(bases, eq(bases.id, userRoles.baseId))
    .where(and(
      eq(userRoles.role, "PRECEPTOR"),
      eq(userRoles.isActive, true),
      eq(userRoles.isArchived, false),
    ))
    .orderBy(asc(users.name));

  // Um preceptor com papel em duas bases volta em duas linhas — juntar aqui
  // evita a mesma pessoa aparecendo duas vezes na lista de escolha.
  const byUser = new Map<string, { id: string; name: string; baseCodes: string[] }>();
  for (const row of rows) {
    const entry = byUser.get(row.id) ?? { id: row.id, name: row.name, baseCodes: [] };
    if (row.baseCode && !entry.baseCodes.includes(row.baseCode)) entry.baseCodes.push(row.baseCode);
    byUser.set(row.id, entry);
  }

  return NextResponse.json({ success: true, data: [...byUser.values()] });
}
