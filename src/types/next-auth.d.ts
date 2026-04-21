import type { DefaultSession, DefaultJWT } from "next-auth";

type Role = "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";

type SessionRole = {
  role: Role;
  facultyId: string | null;
  baseId: string | null;
};

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      // Enriquecido no Corte B (Apr 2026). Sessoes/JWTs anteriores podem
      // carregar Array<Role> (strings); o helper src/lib/roles.ts aceita
      // ambas as formas durante a transicao.
      roles: SessionRole[];
      facultyId: string | null;
      baseId: string | null;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: Role;
    roles?: SessionRole[];
    facultyId: string | null;
    baseId: string | null;
    mustChangePassword?: boolean;
  }
}
