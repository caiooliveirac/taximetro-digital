/**
 * Vagas cedidas por qualquer faculdade na semana — alimenta a Escala USA/CRU/CRL
 * do coordenador, que mostra "Cedida pela X" no lugar da vaga da X.
 */

import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { listReleasedOffersAll } from "@/features/extra-offers/infra/repositories/extra-offer-repository";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ success: false, error: "Período inválido" }, { status: 400 });
  }
  const rows = await listReleasedOffersAll({ from, to });
  return NextResponse.json({ success: true, data: rows });
}
