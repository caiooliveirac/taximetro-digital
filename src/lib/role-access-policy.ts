import type { Role } from "@/lib/roles";

export const ROLE_PREFIX: Record<Role, string> = {
  COORDINATOR: "/admin",
  LEADER: "/leader",
  PRECEPTOR: "/preceptor",
  INTERN: "/intern",
};

export function extractRoleNames(rawRoles: unknown, primaryRole?: string): Role[] {
  const roleSet = new Set<Role>();

  if (Array.isArray(rawRoles)) {
    for (const entry of rawRoles) {
      if (typeof entry === "string" && entry in ROLE_PREFIX) {
        roleSet.add(entry as Role);
      } else if (entry && typeof entry === "object" && "role" in entry) {
        const name = String((entry as { role: unknown }).role);
        if (name in ROLE_PREFIX) roleSet.add(name as Role);
      }
    }
  }

  if (roleSet.size === 0 && primaryRole && primaryRole in ROLE_PREFIX) {
    roleSet.add(primaryRole as Role);
  }

  return [...roleSet];
}

export function canAccessPathWithRoles(pathname: string, primaryRole: string | undefined, roleNames: readonly Role[]): boolean {
  if (!primaryRole || !(primaryRole in ROLE_PREFIX)) return true;

  const allowedPrefix = ROLE_PREFIX[primaryRole as Role];
  if (pathname.startsWith(allowedPrefix)) return true;

  for (const role of roleNames) {
    const prefix = ROLE_PREFIX[role];
    if (pathname.startsWith(prefix)) return true;
  }

  if (primaryRole === "COORDINATOR") return true;

  // LEADER can also use intern self-service flows to fulfill their own shifts.
  if (primaryRole === "LEADER" && pathname.startsWith("/intern")) return true;

  return false;
}
