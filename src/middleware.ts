import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/esqueci-senha", "/redefinir-senha", "/api/auth", "/api/telegram", "/registro", "/api/registro", "/api/health"];
const FORCE_PASSWORD_CHANGE_PATH = "/trocar-senha";

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
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, error: "Não autenticado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const role = token.role as string | undefined;
  const allowedPrefix = role ? ROLE_PREFIX[role] : undefined;
  const roles = Array.isArray(token.roles) ? token.roles.map(String) : role ? [role] : [];
  const allowedPrefixes = new Set(roles.map((item) => ROLE_PREFIX[item]).filter(Boolean));
  const mustChangePassword = Boolean(token.mustChangePassword);

  if (mustChangePassword && pathname !== FORCE_PASSWORD_CHANGE_PATH && !pathname.startsWith(`${FORCE_PASSWORD_CHANGE_PATH}/`) && pathname !== "/api/auth/change-password") {
    if (!pathname.startsWith("/api/")) {
      const url = req.nextUrl.clone();
      url.pathname = FORCE_PASSWORD_CHANGE_PATH;
      return NextResponse.redirect(url);
    }
  }

  if (!mustChangePassword && (pathname === FORCE_PASSWORD_CHANGE_PATH || pathname.startsWith(`${FORCE_PASSWORD_CHANGE_PATH}/`))) {
    const url = req.nextUrl.clone();
    url.pathname = allowedPrefix ?? "/";
    return NextResponse.redirect(url);
  }

  // Root page → let page.tsx handle
  if (pathname === "/" || pathname === "") {
    return NextResponse.next();
  }

  // Check role access
  if (allowedPrefix && !pathname.startsWith(allowedPrefix) && ![...allowedPrefixes].some((prefix) => pathname.startsWith(prefix))) {
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
