import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { compare } from "bcryptjs";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, userRoles } from "@/db/schema";

async function fetchRole(userId: string) {
  const [role] = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.isActive, true)))
    .orderBy(sql`CASE ${userRoles.role} WHEN 'COORDINATOR' THEN 0 WHEN 'LEADER' THEN 1 WHEN 'PRECEPTOR' THEN 2 WHEN 'INTERN' THEN 3 END`)
    .limit(1);
  return role;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  basePath: "/taximetro/api/auth",
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    Credentials({
      credentials: {
        identifier: { label: "Email ou CPF", type: "text" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const identifier = credentials?.identifier as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!identifier || !password) return null;

        let user;
        if (identifier.includes("@")) {
          // Email login
          [user] = await db.select().from(users)
            .where(and(eq(users.email, identifier.toLowerCase().trim()), eq(users.isActive, true)))
            .limit(1);
        } else {
          // CPF login — normalize to format 000.000.000-00
          const digits = identifier.replace(/\D/g, "");
          const cpf = digits.length === 11
            ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
            : identifier;
          [user] = await db.select().from(users)
            .where(and(eq(users.cpf, cpf), eq(users.isActive, true)))
            .limit(1);
        }

        if (!user) return null;

        const valid = await compare(password, user.passwordHash);
        if (!valid) return null;

        const role = await fetchRole(user.id);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: role?.role ?? "INTERN",
          facultyId: role?.facultyId ?? null,
          baseId: role?.baseId ?? null,
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
        if (!user.email) return false;
        const [existing] = await db.select().from(users)
          .where(eq(users.email, user.email))
          .limit(1);
        if (!existing) {
          // New user → redirect to OAuth registration
          const params = new URLSearchParams({
            email: user.email,
            name: user.name ?? "",
          });
          return `/taximetro/registro/google?${params.toString()}`;
        }
        if (!existing.isActive) {
          return "/taximetro/login?error=PendingApproval";
        }
        // Link Google ID if not yet linked
        if (!existing.googleId && account.providerAccountId) {
          await db.update(users)
            .set({ googleId: account.providerAccountId, updatedAt: new Date() })
            .where(eq(users.id, existing.id));
        }
        return true;
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
          token.id = dbUser.id;
          token.role = role?.role ?? "INTERN";
          token.facultyId = role?.facultyId ?? null;
          token.baseId = role?.baseId ?? null;
        }
      } else if (user) {
        token.id = user.id as string;
        token.role = (user as unknown as { role: string }).role as typeof token.role;
        token.facultyId = (user as unknown as { facultyId: string | null }).facultyId;
        token.baseId = (user as unknown as { baseId: string | null }).baseId;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      (session.user as { role: string }).role = token.role as string;
      (session.user as { facultyId: string | null }).facultyId = token.facultyId as string | null;
      (session.user as { baseId: string | null }).baseId = token.baseId as string | null;
      return session;
    },
  },
});
