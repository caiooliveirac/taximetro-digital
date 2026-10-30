import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
  listExtraOffers,
  listExtraOffersForAdmin,
} from "@/features/extra-offers/infra/repositories/extra-offer-repository";
import { comExtraNoHistorico, vagasNaRepescagem } from "@/features/extra-offers/application/repescagem";
import { executeGetComplianceOverview } from "@/features/compliance/application/use-cases/get-compliance-overview";
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
  const includeUnavailable = req.nextUrl.searchParams.get("all") === "true";

  let rows = isAdmin
    ? await listExtraOffersForAdmin()
    : await listExtraOffers({ includeUnavailable });

  // Extra é um por interno (claim-extra-offer.ts): quem já teve não vê extra
  // comum, e da vaga de última hora (repescagem.ts) só as do tipo que ainda
  // falta na meta — essas contam na meta, não são extra.
  const jaTeveExtra = user.role === "INTERN" && !includeUnavailable && !user.isImpersonating && (await comExtraNoHistorico([user.id])).has(user.id);
  if (jaTeveExtra) rows = [];
  let vagas = user.role === "INTERN" && !includeUnavailable && user.facultyId ? await vagasNaRepescagem(user.facultyId) : [];
  if (vagas.length && jaTeveExtra) {
    const { data } = await executeGetComplianceOverview({ actor: { id: "", role: "COORDINATOR", facultyId: null }, internId: user.id });
    const r = data.find((x) => x.userId === user.id);
    const falta = { USA: r?.missingUSA ?? 0, CRU: r?.missingCRU ?? 0, CRL: r?.missingCRL ?? 0 };
    vagas = vagas.filter((v) => v.tipo && falta[v.tipo] > 0);
  }
  const repescagem = vagas.map((v) => ({
      id: v.id, baseId: v.baseId, baseCode: v.baseCode, baseName: v.baseName, baseType: v.baseType,
      date: v.date, period: v.period, shift: v.shift, facultyId: null, facultyAbbreviation: null, notes: null,
      publishedAt: null, repescagem: true, liberadaPor: v.releasedFacultyAbbr ?? null,
    }));

  return NextResponse.json({ success: true, data: [...repescagem, ...rows] });
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
