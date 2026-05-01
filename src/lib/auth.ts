import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, userRoles, cohorts } from "@/db/schema";
import { logAudit } from "@/lib/audit";

type LoginIdentifierType = "EMAIL" | "CPF";
type CredentialLoginFailureReason =
  | "MISSING_CREDENTIALS"
  | "USER_NOT_FOUND"
  | "USER_INACTIVE"
  | "PASSWORD_NOT_SET"
  | "INVALID_PASSWORD"
  | "NO_ACTIVE_ROLE";

type GoogleLoginAction =
  | "LOGIN_GOOGLE_SUCCESS"
  | "LOGIN_GOOGLE_FAILED"
  | "LOGIN_GOOGLE_REDIRECT_REGISTER";
type GoogleLoginFailureReason =
  | "MISSING_EMAIL"
  | "USER_INACTIVE"
  | "DB_ERROR";

function normalizeCpf(identifier: string) {
  const digits = identifier.replace(/\D/g, "");
  if (digits.length !== 11) return identifier;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function maskIdentifier(identifier: string, type: LoginIdentifierType) {
  if (type === "EMAIL") {
    const [local, domain] = identifier.split("@");
    if (!domain) return "***";
    const safeLocal = local.length <= 2 ? "***" : `${local.slice(0, 2)}***`;
    return `${safeLocal}@${domain}`;
  }

  const digits = identifier.replace(/\D/g, "");
  if (digits.length !== 11) return "***";
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
}

function getRequestIp(request?: Request) {
  if (!request) return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || null;
}

async function logGoogleLoginEvent(input: {
  action: GoogleLoginAction;
  email?: string | null;
  reason?: GoogleLoginFailureReason;
  userId?: string;
  userName?: string | null;
  googleId?: string | null;
}) {
  try {
    await logAudit({
      userId: input.userId,
      action: input.action,
      entity: "user",
      entityId: input.userId,
      payload: {
        provider: "google",
        maskedEmail: input.email ? maskIdentifier(input.email, "EMAIL") : null,
        reason: input.reason ?? null,
        userName: input.userName ?? null,
        googleId: input.googleId ?? null,
      },
    });
  } catch (error) {
    console.error("[auth] failed to write google login audit event", {
      action: input.action,
      reason: input.reason,
      error,
    });
  }
}

async function logCredentialLoginEvent(input: {
  action: "LOGIN_CREDENTIALS_FAILED" | "LOGIN_CREDENTIALS_SUCCESS";
  identifier: string;
  identifierType: LoginIdentifierType;
  ipAddress: string | null;
  reason?: CredentialLoginFailureReason;
  userId?: string;
  userName?: string | null;
  userEmail?: string | null;
  role?: string | null;
}) {
  try {
    await logAudit({
      userId: input.userId,
      action: input.action,
      entity: "user",
      entityId: input.userId,
      ipAddress: input.ipAddress ?? undefined,
      payload: {
        identifierType: input.identifierType,
        maskedIdentifier: maskIdentifier(input.identifier, input.identifierType),
        reason: input.reason ?? null,
        userName: input.userName ?? null,
        userEmail: input.userEmail ? maskIdentifier(input.userEmail, "EMAIL") : null,
        role: input.role ?? null,
      },
    });
  } catch (error) {
    console.error("[auth] failed to write login audit event", {
      action: input.action,
      reason: input.reason,
      identifierType: input.identifierType,
      ipAddress: input.ipAddress,
      error,
    });
  }
}

async function fetchRole(userId: string) {
  const [role] = await db
    .select({
      id: userRoles.id,
      userId: userRoles.userId,
      role: userRoles.role,
      facultyId: userRoles.facultyId,
      baseId: userRoles.baseId,
      cohortId: userRoles.cohortId,
      cohortName: cohorts.name,
      isActive: userRoles.isActive,
      isArchived: userRoles.isArchived,
    })
    .from(userRoles)
    .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)))
    .orderBy(sql`CASE ${userRoles.role} WHEN 'COORDINATOR' THEN 0 WHEN 'LEADER' THEN 1 WHEN 'PRECEPTOR' THEN 2 WHEN 'INTERN' THEN 3 END`)
    .limit(1);
  return role;
}

async function fetchRoles(userId: string) {
  const rows = await db
    .select({
      role: userRoles.role,
      facultyId: userRoles.facultyId,
      baseId: userRoles.baseId,
      cohortId: userRoles.cohortId,
      cohortName: cohorts.name,
    })
    .from(userRoles)
    .leftJoin(cohorts, eq(cohorts.id, userRoles.cohortId))
    .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)))
    .orderBy(sql`CASE ${userRoles.role} WHEN 'COORDINATOR' THEN 0 WHEN 'LEADER' THEN 1 WHEN 'PRECEPTOR' THEN 2 WHEN 'INTERN' THEN 3 END`);

  return rows.map((row) => ({
    role: row.role,
    facultyId: row.facultyId ?? null,
    baseId: row.baseId ?? null,
    cohortId: row.cohortId ?? null,
    cohortName: row.cohortName ?? null,
  }));
}

function buildGoogleProviders(): Provider[] {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return [Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })];
  }
  console.error("[auth] GoogleProvider NOT registered — GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET missing in environment");
  return [];
}

const googleProviders = buildGoogleProviders();

export const { handlers, signIn, signOut, auth } = NextAuth({
  basePath: "/taximetro/api/auth",
  providers: [
    ...googleProviders,
    Credentials({
      credentials: {
        identifier: { label: "Email ou CPF", type: "text" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, request) {
        const identifier = credentials?.identifier as string | undefined;
        const password = credentials?.password as string | undefined;
        const trimmedIdentifier = identifier?.trim() ?? "";
        const identifierType: LoginIdentifierType = trimmedIdentifier.includes("@") ? "EMAIL" : "CPF";
        const normalizedIdentifier = identifierType === "EMAIL"
          ? trimmedIdentifier.toLowerCase()
          : normalizeCpf(trimmedIdentifier);
        const ipAddress = getRequestIp(request);

        if (!trimmedIdentifier || !password) {
          await logCredentialLoginEvent({
            action: "LOGIN_CREDENTIALS_FAILED",
            identifier: trimmedIdentifier || "***",
            identifierType,
            ipAddress,
            reason: "MISSING_CREDENTIALS",
          });
          return null;
        }

        let user;
        if (identifierType === "EMAIL") {
          [user] = await db.select().from(users)
            .where(eq(users.email, normalizedIdentifier))
            .limit(1);
        } else {
          [user] = await db.select().from(users)
            .where(eq(users.cpf, normalizedIdentifier))
            .limit(1);
        }

        if (!user) {
          await logCredentialLoginEvent({
            action: "LOGIN_CREDENTIALS_FAILED",
            identifier: normalizedIdentifier,
            identifierType,
            ipAddress,
            reason: "USER_NOT_FOUND",
          });
          return null;
        }

        if (!user.isActive) {
          await logCredentialLoginEvent({
            action: "LOGIN_CREDENTIALS_FAILED",
            identifier: normalizedIdentifier,
            identifierType,
            ipAddress,
            reason: "USER_INACTIVE",
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
          });
          return null;
        }

        if (!user.passwordHash) {
          await logCredentialLoginEvent({
            action: "LOGIN_CREDENTIALS_FAILED",
            identifier: normalizedIdentifier,
            identifierType,
            ipAddress,
            reason: "PASSWORD_NOT_SET",
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
          });
          return null;
        }

        const valid = await compare(password, user.passwordHash);
        if (!valid) {
          await logCredentialLoginEvent({
            action: "LOGIN_CREDENTIALS_FAILED",
            identifier: normalizedIdentifier,
            identifierType,
            ipAddress,
            reason: "INVALID_PASSWORD",
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
          });
          return null;
        }

        const role = await fetchRole(user.id);
        const roles = await fetchRoles(user.id);
        if (!role) {
          await logCredentialLoginEvent({
            action: "LOGIN_CREDENTIALS_FAILED",
            identifier: normalizedIdentifier,
            identifierType,
            ipAddress,
            reason: "NO_ACTIVE_ROLE",
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
          });
          return null;
        }

        await logCredentialLoginEvent({
          action: "LOGIN_CREDENTIALS_SUCCESS",
          identifier: normalizedIdentifier,
          identifierType,
          ipAddress,
          userId: user.id,
          userName: user.name,
          userEmail: user.email,
          role: role.role,
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: role.role,
          roles,
          facultyId: role.facultyId ?? null,
          baseId: role.baseId ?? null,
          cohortId: role.cohortId ?? null,
          cohortName: role.cohortName ?? null,
          mustChangePassword: user.forcePasswordChange,
        };
      },
    }),
  ],
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/taximetro/login",
    error: "/taximetro/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        try {
          if (!user.email) {
            await logGoogleLoginEvent({
              action: "LOGIN_GOOGLE_FAILED",
              reason: "MISSING_EMAIL",
              googleId: account.providerAccountId,
            });
            return false;
          }
          const [existing] = await db.select().from(users)
            .where(eq(users.email, user.email))
            .limit(1);
          if (!existing) {
            // New user → redirect to OAuth registration
            await logGoogleLoginEvent({
              action: "LOGIN_GOOGLE_REDIRECT_REGISTER",
              email: user.email,
              userName: user.name ?? null,
              googleId: account.providerAccountId,
            });
            const params = new URLSearchParams({
              email: user.email,
              name: user.name ?? "",
            });
            return `/taximetro/registro/google?${params.toString()}`;
          }
          if (!existing.isActive) {
            await logGoogleLoginEvent({
              action: "LOGIN_GOOGLE_FAILED",
              reason: "USER_INACTIVE",
              email: user.email,
              userId: existing.id,
              userName: existing.name,
              googleId: account.providerAccountId,
            });
            return "/taximetro/login?error=PendingApproval";
          }
          // Link Google ID if not yet linked
          if (!existing.googleId && account.providerAccountId) {
            await db.update(users)
              .set({ googleId: account.providerAccountId, updatedAt: new Date() })
              .where(eq(users.id, existing.id));
          }
          await logGoogleLoginEvent({
            action: "LOGIN_GOOGLE_SUCCESS",
            email: user.email,
            userId: existing.id,
            userName: existing.name,
            googleId: account.providerAccountId,
          });
          return true;
        } catch (error) {
          console.error("[auth] google signIn callback error", error);
          await logGoogleLoginEvent({
            action: "LOGIN_GOOGLE_FAILED",
            reason: "DB_ERROR",
            email: user.email ?? null,
            googleId: account.providerAccountId,
          });
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user?.email) {
        const [dbUser] = await db.select().from(users)
          .where(and(eq(users.email, user.email), eq(users.isActive, true)))
          .limit(1);
        if (dbUser) {
          const role = await fetchRole(dbUser.id);
          const roles = await fetchRoles(dbUser.id);
          token.id = dbUser.id;
          token.role = role?.role ?? "INTERN";
          token.facultyId = role?.facultyId ?? null;
          token.baseId = role?.baseId ?? null;
          token.cohortId = role?.cohortId ?? null;
          token.cohortName = role?.cohortName ?? null;
          token.roles = roles;
          token.mustChangePassword = dbUser.forcePasswordChange;
        }
      } else if (user) {
        const u = user as unknown as {
          role: string; facultyId: string | null; baseId: string | null;
          cohortId?: string | null; cohortName?: string | null;
          roles?: unknown; mustChangePassword?: boolean;
        };
        token.id = user.id as string;
        token.role = u.role as typeof token.role;
        token.facultyId = u.facultyId;
        token.baseId = u.baseId;
        token.cohortId = u.cohortId ?? null;
        token.cohortName = u.cohortName ?? null;
        const incomingRoles = u.roles;
        token.roles = Array.isArray(incomingRoles) && incomingRoles.length > 0
          ? (incomingRoles as typeof token.roles)
          : [{ role: token.role, facultyId: token.facultyId, baseId: token.baseId }];
        token.mustChangePassword = u.mustChangePassword ?? false;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      (session.user as { role: string }).role = token.role as string;
      (session.user as { facultyId: string | null }).facultyId = token.facultyId as string | null;
      (session.user as { baseId: string | null }).baseId = token.baseId as string | null;
      (session.user as unknown as { cohortId: string | null }).cohortId = (token.cohortId as string | null) ?? null;
      (session.user as unknown as { cohortName: string | null }).cohortName = (token.cohortName as string | null) ?? null;
      (session.user as { roles: unknown }).roles = token.roles
        ?? [{ role: token.role as string, facultyId: token.facultyId ?? null, baseId: token.baseId ?? null }];
      (session.user as { mustChangePassword: boolean }).mustChangePassword = Boolean(token.mustChangePassword);
      return session;
    },
  },
});
