import { NextRequest, NextResponse } from "next/server";
import { sendVoltaParaCasa } from "@/lib/telegram-volta-para-casa";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!process.env.AUTH_SECRET || key !== process.env.AUTH_SECRET) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const result = await sendVoltaParaCasa({ dryRun: req.nextUrl.searchParams.get("dryRun") === "1" });
  return NextResponse.json({ success: true, ...result });
}
