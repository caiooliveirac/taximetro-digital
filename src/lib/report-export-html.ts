import type { ReportFilterInput } from "@/lib/report-filters";

export function encodeReportFilters(filters: ReportFilterInput) {
  return encodeURIComponent(Buffer.from(JSON.stringify(filters), "utf8").toString("base64"));
}

export function decodeReportFilters(encoded: string | undefined) {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Busca uma página de relatório do próprio app e devolve HTML abrível offline,
 * pronto para anexo de e-mail.
 *
 * AttendanceReportDocument é "use client"; renderToStaticMarkup direto não consegue
 * invocar componentes client fora da pipeline RSC do Next. Por isso a página que já
 * faz SSR correto é buscada via fetch loopback.
 */
export async function fetchReportHtmlForEmail(
  path: string,
  headers: Record<string, string>,
  fallbackOrigin?: string,
): Promise<string> {
  const port = process.env.PORT ?? "3000";
  const internalOrigin = `http://127.0.0.1:${port}`;

  const tryFetch = (origin: string) =>
    fetch(`${origin}${path}`, {
      method: "GET",
      headers: { accept: "text/html", ...headers },
      redirect: "manual",
      cache: "no-store",
    });

  let response: Response;
  try {
    response = await tryFetch(internalOrigin);
  } catch (error) {
    if (!fallbackOrigin) throw error;
    response = await tryFetch(fallbackOrigin);
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
