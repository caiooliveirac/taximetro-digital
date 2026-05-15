import { NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import { db } from "@/db";
import { userRoles, cohorts } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";

export interface EffectiveUser {
    id: string;
    role: string;
    facultyId: string | null;
    baseId: string | null;
    cohortId: string | null;
    cohortName: string | null;
    isImpersonating: boolean;
    realUserId: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMPERSONATABLE_ROLES = new Set(["LEADER", "PRECEPTOR", "INTERN"]);

interface ImpersonateContext {
    tokenId: string;
    tokenRole: string;
    tokenRoles: string[];
    selfDefaults: Omit<EffectiveUser, "isImpersonating" | "realUserId">;
    forceRoleHeader: string | null;
    noImpersonateHeader: boolean;
    impersonateUserId: string | null;
    impersonateRole: string | null;
}

async function resolveFromContext(ctx: ImpersonateContext): Promise<EffectiveUser> {
    const self: EffectiveUser = {
        ...ctx.selfDefaults,
        isImpersonating: false,
        realUserId: null,
    };

    if (
        ctx.forceRoleHeader &&
        IMPERSONATABLE_ROLES.has(ctx.forceRoleHeader) &&
        ctx.tokenRoles.includes(ctx.forceRoleHeader)
    ) {
        const [selfAsRequestedRole] = await db
            .select({
                userId: userRoles.userId,
                role: userRoles.role,
                facultyId: userRoles.facultyId,
                baseId: userRoles.baseId,
                cohortId: userRoles.cohortId,
                cohortName: cohorts.name,
            })
            .from(userRoles)
            .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
            .where(and(
                eq(userRoles.userId, ctx.tokenId),
                eq(userRoles.isActive, true),
                eq(userRoles.role, ctx.forceRoleHeader as "LEADER" | "PRECEPTOR" | "INTERN"),
            ))
            .limit(1);

        if (selfAsRequestedRole) {
            return {
                id: selfAsRequestedRole.userId,
                role: selfAsRequestedRole.role,
                facultyId: selfAsRequestedRole.facultyId,
                baseId: selfAsRequestedRole.baseId,
                cohortId: selfAsRequestedRole.cohortId ?? null,
                cohortName: selfAsRequestedRole.cohortName ?? null,
                isImpersonating: false,
                realUserId: null,
            };
        }
    }

    if (ctx.tokenRole !== "COORDINATOR") return self;
    if (ctx.noImpersonateHeader) return self;
    if (!ctx.impersonateUserId || !UUID_RE.test(ctx.impersonateUserId)) return self;

    if (ctx.impersonateRole && IMPERSONATABLE_ROLES.has(ctx.impersonateRole)) {
        const [requestedTargetRole] = await db
            .select({
                userId: userRoles.userId,
                role: userRoles.role,
                facultyId: userRoles.facultyId,
                baseId: userRoles.baseId,
                cohortId: userRoles.cohortId,
                cohortName: cohorts.name,
            })
            .from(userRoles)
            .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
            .where(and(
                eq(userRoles.userId, ctx.impersonateUserId),
                eq(userRoles.isActive, true),
                eq(userRoles.role, ctx.impersonateRole as "LEADER" | "PRECEPTOR" | "INTERN"),
            ))
            .limit(1);

        if (requestedTargetRole) {
            return {
                id: requestedTargetRole.userId,
                role: requestedTargetRole.role,
                facultyId: requestedTargetRole.facultyId,
                baseId: requestedTargetRole.baseId,
                cohortId: requestedTargetRole.cohortId ?? null,
                cohortName: requestedTargetRole.cohortName ?? null,
                isImpersonating: true,
                realUserId: ctx.tokenId,
            };
        }
    }

    const [targetRole] = await db
        .select({
            userId: userRoles.userId,
            role: userRoles.role,
            facultyId: userRoles.facultyId,
            baseId: userRoles.baseId,
            cohortId: userRoles.cohortId,
            cohortName: cohorts.name,
        })
        .from(userRoles)
        .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
        .where(and(eq(userRoles.userId, ctx.impersonateUserId), eq(userRoles.isActive, true)))
        .orderBy(
            sql`CASE ${userRoles.role} WHEN 'COORDINATOR' THEN 0 WHEN 'LEADER' THEN 1 WHEN 'PRECEPTOR' THEN 2 WHEN 'INTERN' THEN 3 END`,
        )
        .limit(1);

    if (!targetRole || targetRole.role === "COORDINATOR") return self;

    return {
        id: targetRole.userId,
        role: targetRole.role,
        facultyId: targetRole.facultyId,
        baseId: targetRole.baseId,
        cohortId: targetRole.cohortId ?? null,
        cohortName: targetRole.cohortName ?? null,
        isImpersonating: true,
        realUserId: ctx.tokenId,
    };
}

/**
 * Para Route Handlers (recebem NextRequest). Continua usando getToken para
 * compatibilidade com o caminho existente.
 */
export async function getEffectiveUser(req: NextRequest): Promise<EffectiveUser | null> {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
    if (!token) return null;

    const tokenRolesRaw = Array.isArray(token.roles) ? token.roles : [];
    const tokenRoles = tokenRolesRaw
        .map((r) => (typeof r === "string" ? r : (r && typeof r === "object" && "role" in r ? String((r as { role: string }).role) : "")))
        .filter(Boolean);
    if (tokenRoles.length === 0 && token.role) tokenRoles.push(String(token.role));

    return resolveFromContext({
        tokenId: token.id as string,
        tokenRole: token.role as string,
        tokenRoles,
        selfDefaults: {
            id: token.id as string,
            role: token.role as string,
            facultyId: (token.facultyId as string | null) ?? null,
            baseId: (token.baseId as string | null) ?? null,
            cohortId: (token.cohortId as string | null) ?? null,
            cohortName: (token.cohortName as string | null) ?? null,
        },
        forceRoleHeader: req.headers.get("x-force-role"),
        noImpersonateHeader: req.headers.get("x-no-impersonate") === "1",
        impersonateUserId:
            req.headers.get("x-impersonate-user") ??
            req.cookies.get("x-impersonate-user")?.value ??
            null,
        impersonateRole:
            req.headers.get("x-impersonate-role") ??
            req.cookies.get("x-impersonate-role")?.value ??
            null,
    });
}

/**
 * Para Server Actions / Server Components — usa cookies()/headers() do
 * next/headers em vez de NextRequest, e auth() do NextAuth v5 em vez de
 * getToken (que precisa de req).
 */
export async function getEffectiveUserFromContext(): Promise<EffectiveUser | null> {
    const session = await auth();
    if (!session?.user?.id) return null;

    const cookieStore = await cookies();
    const headerStore = await headers();

    const sessionUser = session.user as {
        id: string;
        role: string;
        facultyId: string | null;
        baseId: string | null;
        cohortId?: string | null;
        cohortName?: string | null;
        roles?: unknown;
    };

    const rolesRaw = Array.isArray(sessionUser.roles) ? sessionUser.roles : [];
    const tokenRoles = rolesRaw
        .map((r) => (typeof r === "string" ? r : (r && typeof r === "object" && "role" in r ? String((r as { role: string }).role) : "")))
        .filter(Boolean);
    if (tokenRoles.length === 0 && sessionUser.role) tokenRoles.push(sessionUser.role);

    return resolveFromContext({
        tokenId: sessionUser.id,
        tokenRole: sessionUser.role,
        tokenRoles,
        selfDefaults: {
            id: sessionUser.id,
            role: sessionUser.role,
            facultyId: sessionUser.facultyId ?? null,
            baseId: sessionUser.baseId ?? null,
            cohortId: sessionUser.cohortId ?? null,
            cohortName: sessionUser.cohortName ?? null,
        },
        forceRoleHeader: headerStore.get("x-force-role"),
        noImpersonateHeader: headerStore.get("x-no-impersonate") === "1",
        impersonateUserId:
            headerStore.get("x-impersonate-user") ??
            cookieStore.get("x-impersonate-user")?.value ??
            null,
        impersonateRole:
            headerStore.get("x-impersonate-role") ??
            cookieStore.get("x-impersonate-role")?.value ??
            null,
    });
}
