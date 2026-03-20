import type { DefaultSession, DefaultJWT } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
      facultyId: string | null;
      baseId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
    facultyId: string | null;
    baseId: string | null;
  }
}
