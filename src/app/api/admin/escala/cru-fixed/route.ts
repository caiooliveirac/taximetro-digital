/**
 * CRU fixo semanal pela tela de montar escala do coordenador.
 *
 * Mesmos casos de uso da rota do líder (`/api/leader/cru-fixed`) — eles já
 * aceitam COORDINATOR desde que o ator traga uma faculdade (ver
 * `canManageCruFixed`). A faculdade aqui vem da tela.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { escopoDoAdminNaEscala } from "@/lib/admin-escala";
import { executeListCruFixed } from "@/features/scheduling/application/use-cases/list-cru-fixed";
import {
  addCruFixedSchema,
  executeAddCruFixed,
  executeRemoveCruFixed,
} from "@/features/scheduling/application/use-cases/add-cru-fixed";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const escopo = await escopoDoAdminNaEscala(req, req.nextUrl.searchParams.get("facultyId"));
  if (!escopo.ok) return escopo.resposta;

  const result = await executeListCruFixed({ actor: escopo.actor });
  return NextResponse.json(result.body, { status: result.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const escopo = await escopoDoAdminNaEscala(req, body?.facultyId);
  if (!escopo.ok) return escopo.resposta;

  const parsed = addCruFixedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }

  const result = await executeAddCruFixed({ actor: escopo.actor, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const escopo = await escopoDoAdminNaEscala(req, req.nextUrl.searchParams.get("facultyId"));
  if (!escopo.ok) return escopo.resposta;

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ success: false, error: "ID inválido" }, { status: 400 });
  }

  const result = await executeRemoveCruFixed({ actor: escopo.actor, id });
  return NextResponse.json(result.body, { status: result.status });
}
