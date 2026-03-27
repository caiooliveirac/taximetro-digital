import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/redefinir-senha", "/api/auth", "/api/telegram", "/registro", "/api/registro", "/api/health"];

const ROLE_PREFIX: Record<string, string> = {
  COORDINATOR: "/admin",
  LEADER: "/leader",
  PRECEPTOR: "/preceptor",
  INTERN: "/intern",
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });

  // Not authenticated → redirect to login
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const role = token.role as string | undefined;
  const allowedPrefix = role ? ROLE_PREFIX[role] : undefined;

  // Root page → let page.tsx handle
  if (pathname === "/" || pathname === "") {
    return NextResponse.next();
  }

  // Check role access
  if (allowedPrefix && !pathname.startsWith(allowedPrefix)) {
    if (role === "COORDINATOR") return NextResponse.next();

    // LEADER can also use intern self-service flows to fulfill their own shifts.
    if (role === "LEADER" && pathname.startsWith("/intern")) {
      return NextResponse.next();
    }

    if (!pathname.startsWith("/api/")) {
      const url = req.nextUrl.clone();
      url.pathname = allowedPrefix;
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
