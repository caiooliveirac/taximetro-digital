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

// ==========================================================================
// Diff puro de user_roles — usado pela API de admin/users para aplicar
// mudanças de papel preservando histórico (sem DELETE).
// ==========================================================================

export type RoleAssignment = {
  role: Role;
  facultyId: string | null;
  baseId: string | null;
};

export type ExistingRoleRow = RoleAssignment & {
  id: string;
  isActive: boolean;
};

export type RoleDiff = {
  /** Linhas novas a inserir (não existem no banco, nem ativas nem inativas). */
  toInsert: RoleAssignment[];
  /** IDs de linhas ativas que devem ser desativadas (isActive = false). */
  toDeactivate: string[];
  /** IDs de linhas inativas que devem ser reativadas (isActive = true). */
  toReactivate: string[];
};

function roleKey(r: RoleAssignment): string {
  return `${r.role}|${r.facultyId ?? ""}|${r.baseId ?? ""}`;
}

/**
 * Calcula o diff entre as roles existentes no banco e as roles desejadas
 * após o update. Regras:
 *
 * - Nenhum DELETE. Remoções são expressas como `isActive = false`.
 * - Se uma role desejada já existe ativa → no-op (não entra em nenhum array).
 * - Se uma role desejada existe inativa → `toReactivate`.
 * - Se uma role desejada não existe → `toInsert`.
 * - Se uma role ativa atual não está no desejado → `toDeactivate`.
 *
 * Match é feito pela chave (role, facultyId, baseId) — mesma do uq_user_role_faculty.
 */
export function computeRoleDiff(
  existing: ExistingRoleRow[],
  desired: RoleAssignment[],
): RoleDiff {
  const existingByKey = new Map<string, ExistingRoleRow>();
  for (const row of existing) {
    existingByKey.set(roleKey(row), row);
  }

  const desiredByKey = new Map<string, RoleAssignment>();
  for (const row of desired) {
    desiredByKey.set(roleKey(row), row);
  }

  const toInsert: RoleAssignment[] = [];
  const toReactivate: string[] = [];
  for (const [key, row] of desiredByKey) {
    const current = existingByKey.get(key);
    if (!current) {
      toInsert.push(row);
      continue;
    }
    if (!current.isActive) {
      toReactivate.push(current.id);
    }
    // current.isActive === true → no-op
  }

  const toDeactivate: string[] = [];
  for (const [key, row] of existingByKey) {
    if (!row.isActive) continue;
    if (!desiredByKey.has(key)) {
      toDeactivate.push(row.id);
    }
  }

  return { toInsert, toDeactivate, toReactivate };
}

/**
 * Valida e normaliza uma lista de roles vinda do payload. Regras:
 * - LEADER / INTERN exigem facultyId (baseId null).
 * - PRECEPTOR exige baseId (facultyId null).
 * - COORDINATOR não tem facultyId nem baseId.
 * - Duplicatas exatas (mesma tripla) são deduplicadas.
 *
 * Retorna `{ ok: true, roles }` ou `{ ok: false, error }`.
 */
export function normalizeRolesPayload(
  input: Array<{ role: Role; facultyId?: string | null; baseId?: string | null }>,
): { ok: true; roles: RoleAssignment[] } | { ok: false; error: string } {
  if (input.length === 0) {
    return { ok: false, error: "Usuário deve ter pelo menos uma role" };
  }

  const seen = new Set<string>();
  const out: RoleAssignment[] = [];

  for (const entry of input) {
    if (entry.role === "LEADER" || entry.role === "INTERN") {
      if (!entry.facultyId) {
        return { ok: false, error: `Faculdade obrigatória para papel ${entry.role}` };
      }
      const normalized: RoleAssignment = { role: entry.role, facultyId: entry.facultyId, baseId: null };
      const key = roleKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
      continue;
    }

    if (entry.role === "PRECEPTOR") {
      // Historicamente, PRECEPTOR ativa sem base_id e' valido — significa
      // "preceptor sem base fixa, pode atuar em qualquer base". Mantemos
      // baseId opcional para nao bloquear edicao de preceptores legados.
      const normalized: RoleAssignment = { role: "PRECEPTOR", facultyId: null, baseId: entry.baseId ?? null };
      const key = roleKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
      continue;
    }

    if (entry.role === "COORDINATOR") {
      const normalized: RoleAssignment = { role: "COORDINATOR", facultyId: null, baseId: null };
      const key = roleKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
      continue;
    }
  }

  return { ok: true, roles: out };
}
