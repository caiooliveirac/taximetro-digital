/**
 * Vaga reservada pela coordenação (ver reserve-slot.ts).
 * POST reserva uma vaga aberta; DELETE ?id desfaz. A lista vem junto das
 * cedidas em /api/admin/released-slots (campo reservedBy).
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  executeCancelReservation,
  executeReserveSlot,
  reserveSlotSchema,
} from "@/features/scheduling/application/use-cases/reserve-slot";

export const dynamic = "force-dynamic";

async function ator(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "COORDINATOR") return null;
  return {
    id: user.id,
    role: user.role,
    facultyId: user.facultyId,
    isImpersonating: user.isImpersonating,
    realUserId: user.realUserId,
  };
}

const semPermissao = () => NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

export async function POST(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const parsed = reserveSlotSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }
  const result = await executeReserveSlot({ actor, input: parsed.data });
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE(req: NextRequest) {
  const actor = await ator(req);
  if (!actor) return semPermissao();
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }
  const result = await executeCancelReservation({ actor, id });
  return NextResponse.json(result.body, { status: result.status });
}
