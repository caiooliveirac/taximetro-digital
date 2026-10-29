import { NextRequest, NextResponse } from "next/server";
import { executarAvisosDaDai, type TipoDeAviso } from "@/features/dai-avisos/avisos";
import { temFeature } from "@/lib/instance";

export const dynamic = "force-dynamic";

const TIPOS: TipoDeAviso[] = ["plantao", "vagas", "lideres", "trocas"];

function isAuthorized(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  return Boolean(process.env.AUTH_SECRET) && key === process.env.AUTH_SECRET;
}

/**
 * Avisos da Dai no chat (src/features/dai-avisos/avisos.ts), disparados pelo
 * cron do container — ver scripts/container-entrypoint.sh. `?dry=1` monta e
 * conta sem enviar.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const tipo = req.nextUrl.searchParams.get("tipo") as TipoDeAviso;
  if (!TIPOS.includes(tipo)) return NextResponse.json({ success: false, error: "tipo: plantao | vagas | lideres | trocas" }, { status: 400 });
  if (!temFeature("avisosDaDai")) return NextResponse.json({ success: true, skipped: "feature desligada nesta instância" });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  // Aviso de trocas só envia com a feature ligada; o teste (?dry=1) sempre roda.
  if (tipo === "trocas" && !dry && !temFeature("avisoDeTrocas")) {
    return NextResponse.json({ success: true, skipped: "aviso de trocas desligado (avisoDeTrocas)" });
  }
  const result = await executarAvisosDaDai(tipo, { dry });
  return NextResponse.json({ success: true, ...result });
}
