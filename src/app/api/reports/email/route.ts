import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { generateAdminReport } from "@/lib/admin-report-builder";
import { reportFilterInputSchema, type ReportFilterInput } from "@/lib/report-filters";
import { getEmailErrorSummary, sendReportEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  to: z.string().trim().email("Email inválido"),
  filters: reportFilterInputSchema,
});

export async function POST(req: NextRequest) {
  try {
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

    const headerStore = await headers();
    const ipAddress = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || headerStore.get("x-real-ip") || undefined;
    const html = await fetchExportHtml(req, filters);

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[reports/email] unhandled error", { message, stack });
    return NextResponse.json(
      { success: false, error: "Erro interno ao gerar o relatório.", diagnostic: message },
      { status: 500 },
    );
  }
}

async function fetchExportHtml(req: NextRequest, filters: ReportFilterInput): Promise<string> {
  // AttendanceReportDocument é "use client"; renderToStaticMarkup direto não consegue
  // invocar componentes client fora da pipeline RSC do Next. Reusamos a página
  // /admin/relatorios/export, que já faz SSR correto, via fetch loopback.
  const encodedFilters = Buffer.from(JSON.stringify(filters), "utf8").toString("base64");
  const port = process.env.PORT ?? "3000";
  const internalOrigin = `http://127.0.0.1:${port}`;
  const requestOrigin = new URL(req.url).origin;
  const exportPath = `/taximetro/admin/relatorios/export?format=html&filters=${encodeURIComponent(encodedFilters)}`;
  const cookie = req.headers.get("cookie") ?? "";

  const tryFetch = async (origin: string) => {
    return fetch(`${origin}${exportPath}`, {
      method: "GET",
      headers: { cookie, accept: "text/html" },
      redirect: "manual",
      cache: "no-store",
    });
  };

  let response: Response;
  try {
    response = await tryFetch(internalOrigin);
  } catch {
    response = await tryFetch(requestOrigin);
  }

  if (!response.ok) {
    throw new Error(`Falha ao renderizar export (${response.status} ${response.statusText})`);
  }
  return response.text();
}
