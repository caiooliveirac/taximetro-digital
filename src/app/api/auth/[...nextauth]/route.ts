import { handlers } from "@/lib/auth";
import { NextRequest } from "next/server";

// Next.js strips basePath ("/taximetro") from the URL before passing to route
// handlers, but NextAuth needs the full path to construct correct redirect URIs.
// Rewrite the URL to include the basePath so NextAuth routing works properly.
function withBasePath(request: NextRequest): NextRequest {
    const url = request.nextUrl.clone();
    if (url.pathname !== "/taximetro" && !url.pathname.startsWith("/taximetro/")) {
        url.pathname = `/taximetro${url.pathname}`;
    }
    return new NextRequest(url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });
}

export const GET = (request: NextRequest) => handlers.GET(withBasePath(request));
export const POST = (request: NextRequest) => handlers.POST(withBasePath(request));
