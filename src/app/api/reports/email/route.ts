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
  const rawHtml = await response.text();
  return inlineAssetsForEmail(rawHtml, internalOrigin);
}

// Transforma o HTML do Next em algo abrível offline:
// 1. Inline cada <link rel="stylesheet"> (fetch loopback do CSS e embute em <style>)
// 2. Remove <script> e preloads de script (sem servidor pra entregá-los)
async function inlineAssetsForEmail(html: string, origin: string): Promise<string> {
  const linkStylesheetRegex = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
  const hrefRegex = /href=["']([^"']+)["']/i;
  const stylesheetTags = html.match(linkStylesheetRegex) ?? [];

  const cssChunks: string[] = [];
  for (const tag of stylesheetTags) {
    const hrefMatch = tag.match(hrefRegex);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];
    const url = href.startsWith("http") ? href : `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
    try {
      const cssResponse = await fetch(url, { cache: "no-store" });
      if (cssResponse.ok) cssChunks.push(await cssResponse.text());
    } catch {
      // se falhar, segue sem esse stylesheet
    }
  }

  let out = html
    .replace(linkStylesheetRegex, "")
    .replace(/<link[^>]+rel=["']preload["'][^>]+as=["']script["'][^>]*\/?>/gi, "")
    .replace(/<link[^>]+rel=["']manifest["'][^>]*\/?>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "");

  if (cssChunks.length > 0) {
    const inlineStyle = `<style>${cssChunks.join("\n")}</style>`;
    out = out.includes("</head>") ? out.replace("</head>", `${inlineStyle}</head>`) : `${inlineStyle}${out}`;
  }
  return out;
}
