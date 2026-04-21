import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";

export type Role = "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";

/**
 * Forma "rica" de uma role com escopo. Quando o NextAuth passar a popular
 * `session.user.roles` como `SessionRole[]` (hoje é `Role[]`), o helper
 * automaticamente respeitará o parâmetro `scope`.
 */
export type SessionRole = {
  role: Role;
  facultyId: string | null;
  baseId: string | null;
};

const VALID_ROLES: ReadonlySet<Role> = new Set(["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"]);

function extractRoles(raw: unknown): SessionRole[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionRole[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (VALID_ROLES.has(entry as Role)) {
        out.push({ role: entry as Role, facultyId: null, baseId: null });
      }
      continue;
    }
    if (entry && typeof entry === "object" && "role" in entry) {
      const r = (entry as { role: unknown }).role;
      if (typeof r === "string" && VALID_ROLES.has(r as Role)) {
        const facultyId = (entry as { facultyId?: unknown }).facultyId;
        const baseId = (entry as { baseId?: unknown }).baseId;
        out.push({
          role: r as Role,
          facultyId: typeof facultyId === "string" ? facultyId : null,
          baseId: typeof baseId === "string" ? baseId : null,
        });
      }
    }
  }
  return out;
}

function matches(role: Role, target: Role, rawEntry: SessionRole, scope?: { facultyId?: string; baseId?: string }): boolean {
  if (role !== target) return false;
  if (!scope) return true;
  // Scope só é avaliado quando a entrada original carrega facultyId/baseId.
  // Hoje o NextAuth popula roles como Role[] puro (sem escopo). Nesse caso,
  // o helper NÃO concede a permissão baseada em scope — falha fechado.
  if (scope.facultyId !== undefined) {
    if (!rawEntry.facultyId || rawEntry.facultyId !== scope.facultyId) return false;
  }
  if (scope.baseId !== undefined) {
    if (!rawEntry.baseId || rawEntry.baseId !== scope.baseId) return false;
  }
  return true;
}

/**
 * Fonte única de verdade para autorização multi-role.
 * Retorna true se o usuário tem a role solicitada ATIVA na sessão.
 *
 * REGRAS:
 * - Sessão/roles ausente ou vazio → false (fail-closed).
 * - Não consulta o banco. A sessão já foi populada no login.
 * - Se `scope` for passado e as entradas de role não carregarem escopo, retorna false.
 */
export function sessionHasRole(
  session: Session | null | undefined,
  role: Role,
  scope?: { facultyId?: string; baseId?: string },
): boolean {
  const roles = extractRoles((session?.user as { roles?: unknown } | undefined)?.roles);
  if (roles.length === 0) return false;
  return roles.some((entry) => matches(entry.role, role, entry, scope));
}

/**
 * Versão para contextos que só têm JWT (middleware, webhooks).
 * Mesma semântica de `sessionHasRole`.
 */
export function tokenHasRole(
  token: JWT | null | undefined,
  role: Role,
  scope?: { facultyId?: string; baseId?: string },
): boolean {
  const roles = extractRoles((token as { roles?: unknown } | null | undefined)?.roles);
  if (roles.length === 0) return false;
  return roles.some((entry) => matches(entry.role, role, entry, scope));
}

/**
 * Guard para endpoints que aceitam múltiplas roles.
 * Retorna true se o usuário tem QUALQUER UMA das roles listadas.
 */
export function sessionHasAnyRole(
  session: Session | null | undefined,
  roles: readonly Role[],
): boolean {
  return roles.some((r) => sessionHasRole(session, r));
}
