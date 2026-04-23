import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { sessionHasAnyRole, tokenHasRole } from "@/lib/roles";

export function canStartCheckin(token: JWT | null | undefined, impersonating: boolean): boolean {
  if (impersonating) return true;
  return tokenHasRole(token, "INTERN");
}

export function canValidateCheckin(session: Session | null | undefined): boolean {
  return sessionHasAnyRole(session, ["PRECEPTOR", "COORDINATOR"]);
}

export function canConfirmCheckout(session: Session | null | undefined): boolean {
  return sessionHasAnyRole(session, ["COORDINATOR", "PRECEPTOR"]);
}
