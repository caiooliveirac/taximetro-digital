/**
 * Liberações da agenda acadêmica, todas as faculdades (ou ?facultyId=).
 * Mesmos casos de uso da rota do líder (ver commitment-releases.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  executeListReleases,
  executeResolveRelease,
  resolveReleaseSchema,
} from "@/features/scheduling/application/use-cases/commitment-releases";

export const dynamic = "force-dynamic";

async function ator(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "COORDINATOR") return null;
  return { id: user.id, role: user.role, facultyId: null, isImpersonating: user.isImpersonating, realUserId: user.realUserId };
}

const semPermissao = () => NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

export async function GET(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const result = await executeListReleases({ actor, facultyId: req.nextUrl.searchParams.get("facultyId") });
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const parsed = resolveReleaseSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  const result = await executeResolveRelease({ actor, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}
