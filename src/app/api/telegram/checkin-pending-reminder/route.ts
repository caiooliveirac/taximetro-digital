import { NextRequest, NextResponse } from "next/server";
import { sendPendingCheckinReminder } from "@/lib/telegram-checkin-pending-reminder";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  return Boolean(process.env.AUTH_SECRET) && key === process.env.AUTH_SECRET;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const result = await sendPendingCheckinReminder({
    dryRun,
    notifyWhenEmpty: false,
    source: "CRON",
  });

  return NextResponse.json({
    success: true,
    sent: result.sent,
    pendingCount: result.pendingCount,
    preview: result.preview,
    reason: result.reason,
  });
}