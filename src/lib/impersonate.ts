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
const IMPERSONATABLE_ROLES = new Set(["LEADER", "PRECEPTOR", "INTERN"]);

/**
 * Returns the effective user identity for an API request.
 * If the real user is a COORDINATOR and the impersonate cookie/header is set,
 * returns the impersonated user's identity.
 * Otherwise returns the authenticated user's own identity.
 */
export async function getEffectiveUser(req: NextRequest): Promise<EffectiveUser | null> {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
    if (!token) return null;

    const tokenRolesRaw = Array.isArray(token.roles) ? token.roles : [];
    const tokenRoles = tokenRolesRaw
        .map((r) => (typeof r === "string" ? r : (r && typeof r === "object" && "role" in r ? String((r as { role: string }).role) : "")))
        .filter(Boolean);
    if (tokenRoles.length === 0 && token.role) tokenRoles.push(String(token.role));
    const requestedSelfRole = req.headers.get("x-force-role");

    if (requestedSelfRole && IMPERSONATABLE_ROLES.has(requestedSelfRole) && tokenRoles.includes(requestedSelfRole)) {
        const [selfAsRequestedRole] = await db
            .select({
                userId: userRoles.userId,
                role: userRoles.role,
                facultyId: userRoles.facultyId,
                baseId: userRoles.baseId,
            })
            .from(userRoles)
            .where(and(
                eq(userRoles.userId, token.id as string),
                eq(userRoles.isActive, true),
                eq(userRoles.role, requestedSelfRole as "LEADER" | "PRECEPTOR" | "INTERN"),
            ))
            .limit(1);

        if (selfAsRequestedRole) {
            return {
                id: selfAsRequestedRole.userId,
                role: selfAsRequestedRole.role,
                facultyId: selfAsRequestedRole.facultyId,
                baseId: selfAsRequestedRole.baseId,
                isImpersonating: false,
                realUserId: null,
            };
        }
    }

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
    const requestedRole =
        req.headers.get("x-impersonate-role") ??
        req.cookies.get("x-impersonate-role")?.value ??
        null;

    if (!impersonateId || !UUID_RE.test(impersonateId)) return self;

    if (requestedRole && IMPERSONATABLE_ROLES.has(requestedRole)) {
        const [requestedTargetRole] = await db
            .select({
                userId: userRoles.userId,
                role: userRoles.role,
                facultyId: userRoles.facultyId,
                baseId: userRoles.baseId,
            })
            .from(userRoles)
            .where(and(
                eq(userRoles.userId, impersonateId),
                eq(userRoles.isActive, true),
                eq(userRoles.role, requestedRole as "LEADER" | "PRECEPTOR" | "INTERN"),
            ))
            .limit(1);

        if (requestedTargetRole) {
            return {
                id: requestedTargetRole.userId,
                role: requestedTargetRole.role,
                facultyId: requestedTargetRole.facultyId,
                baseId: requestedTargetRole.baseId,
                isImpersonating: true,
                realUserId: token.id as string,
            };
        }
    }

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
