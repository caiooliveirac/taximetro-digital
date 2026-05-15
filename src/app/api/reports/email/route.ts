import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { renderAttendanceReportHTML } from "@/lib/attendance-report-html";
import { reportFilterInputSchema } from "@/lib/report-filters";
import { getEmailErrorSummary, sendReportEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  to: z.string().trim().email("Email inválido"),
  filters: reportFilterInputSchema,
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Payload inválido", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { to, filters } = parsed.data;
  const { document, exportBaseName } = await generateAdminReport(filters);
  const html = await renderAttendanceReportHTML(document);

  const headerStore = await headers();
  const ipAddress = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || undefined;

  try {
    await sendReportEmail(
      to,
      html,
      {
        facultyLabel: document.facultyLabel,
        periodLabel: document.periodLabel,
        scopeLabel: document.scopeLabel,
        internCount: document.previewSummary.internCount,
        assignmentCount: document.previewSummary.assignmentCount,
      },
      exportBaseName,
      session.user.name ?? null,
    );
  } catch (error) {
    const summary = getEmailErrorSummary(error);
    await logAudit({
      userId: session.user.id,
      action: "report.email_failed",
      entity: "report",
      payload: { to, filters, errorCode: summary.code, diagnostic: summary.diagnostic },
      ipAddress,
    });
    return NextResponse.json({ success: false, error: summary.message, code: summary.code }, { status: summary.statusCode });
  }

  await logAudit({
    userId: session.user.id,
    action: "report.emailed",
    entity: "report",
    payload: {
      to,
      filters,
      facultyLabel: document.facultyLabel,
      periodLabel: document.periodLabel,
      internCount: document.previewSummary.internCount,
      assignmentCount: document.previewSummary.assignmentCount,
    },
    ipAddress,
  });

  return NextResponse.json({ success: true, data: { to } });
}
