import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeClaimExtraOffer } from "@/features/extra-offers/application/use-cases/claim-extra-offer";
import { executeCancelExtraOffer } from "@/features/extra-offers/application/use-cases/cancel-extra-offer";

/* ═══════════ POST /api/extra-offers/[id]/claim ═══════════ */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  // Corpo opcional: líder/coordenador alocando um interno numa vaga livre.
  const body = await req.json().catch(() => ({})) as { internId?: unknown; facultyId?: unknown };
  const uuid = /^[0-9a-f-]{36}$/i;
  const internId = typeof body.internId === "string" && uuid.test(body.internId) ? body.internId : undefined;
  const facultyId = typeof body.facultyId === "string" && uuid.test(body.facultyId) ? body.facultyId : undefined;

  const result = await executeClaimExtraOffer({
    actor: { id: user.id, role: user.role, facultyId: user.facultyId },
    offerId: id,
    internId,
    facultyId,
  });

  return NextResponse.json(result.body, { status: result.status });
}

/* ═══════════ DELETE /api/extra-offers/[id] ═══════════ */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const { id } = await params;

  const result = await executeCancelExtraOffer({
    actor: { id: user.id, role: user.role },
    offerId: id,
  });

  return NextResponse.json(result.body, { status: result.status });
}
