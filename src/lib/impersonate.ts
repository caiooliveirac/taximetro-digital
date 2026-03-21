import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { userRoles } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export interface EffectiveUser {
    id: string;
    role: string;
    facultyId: string | null;
    baseId: string | null;
    isImpersonating: boolean;
    realUserId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the effective user identity for an API request.
 * If the real user is a COORDINATOR and the impersonate cookie/header is set,
 * returns the impersonated user's identity.
 * Otherwise returns the authenticated user's own identity.
 */
export async function getEffectiveUser(req: NextRequest): Promise<EffectiveUser | null> {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
    if (!token) return null;

    const self: EffectiveUser = {
        id: token.id as string,
        role: token.role as string,
        facultyId: token.facultyId as string | null,
        baseId: token.baseId as string | null,
        isImpersonating: false,
        realUserId: null,
    };

    // Only COORDINATOR can impersonate
    if (token.role !== "COORDINATOR") return self;

    // Check for bypass header (used by impersonate selector to fetch unfiltered data)
    if (req.headers.get("x-no-impersonate") === "1") return self;

    // Check header first, then cookie
    const impersonateId =
        req.headers.get("x-impersonate-user") ??
        req.cookies.get("x-impersonate-user")?.value;

    if (!impersonateId || !UUID_RE.test(impersonateId)) return self;

    const [targetRole] = await db
        .select({
            userId: userRoles.userId,
            role: userRoles.role,
            facultyId: userRoles.facultyId,
            baseId: userRoles.baseId,
        })
        .from(userRoles)
        .where(and(eq(userRoles.userId, impersonateId), eq(userRoles.isActive, true)))
        .orderBy(
            sql`CASE ${userRoles.role} WHEN 'COORDINATOR' THEN 0 WHEN 'LEADER' THEN 1 WHEN 'PRECEPTOR' THEN 2 WHEN 'INTERN' THEN 3 END`,
        )
        .limit(1);

    // Can't impersonate non-existent user or another coordinator
    if (!targetRole || targetRole.role === "COORDINATOR") return self;

    return {
        id: targetRole.userId,
        role: targetRole.role,
        facultyId: targetRole.facultyId,
        baseId: targetRole.baseId,
        isImpersonating: true,
        realUserId: token.id as string,
    };
}
