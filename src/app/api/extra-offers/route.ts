import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  listExtraOffers,
  listExtraOffersForAdmin,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import {
  executePublishExtraOffer,
  publishExtraOfferSchema,
} from "@/features/extra-offers/application/use-cases/publish-extra-offer";

function formatPublishExtraValidationError(error: {
  issues: Array<{ path: Array<PropertyKey> }>;
}) {
  const firstPath = String(error.issues[0]?.path?.[0] ?? "");

  if (firstPath === "baseId") {
    return "Base inválida. Atualize a página e selecione a base novamente.";
  }
  if (firstPath === "date") {
    return "Data inválida para publicação. Use o seletor de data novamente.";
  }
  if (firstPath === "facultyId") {
    return "Faculdade inválida para esta vaga.";
  }
  if (firstPath === "period") {
    return "Turno inválido para publicação.";
  }

  return "Dados inválidos para publicação do plantão extra.";
}

/* ═══════════ GET — list offers ═══════════ */

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const isAdmin = user.role === "COORDINATOR";
  const includeUnavailable = new URL(req.url).searchParams.get("all") === "true";

  const rows = isAdmin
    ? await listExtraOffersForAdmin()
    : await listExtraOffers({ includeUnavailable });

  return NextResponse.json({ success: true, data: rows });
}

/* ═══════════ POST — publish offer ═══════════ */

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user) return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = publishExtraOfferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: formatPublishExtraValidationError(parsed.error) }, { status: 400 });
  }

  const result = await executePublishExtraOffer({
    actor: { id: user.id, role: user.role, facultyId: user.facultyId },
    input: parsed.data,
  });

  return NextResponse.json(result.body, { status: result.status });
}
