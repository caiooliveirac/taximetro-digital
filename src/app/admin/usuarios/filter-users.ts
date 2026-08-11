export type UserFilters = {
  q: string;
  status: "" | "active" | "pending" | "archived";
  fac: string;   // facultyId
  turma: string; // cohortId
  papel: string; // role
  sort: "" | "newest" | "oldest";
};

export const EMPTY_FILTERS: UserFilters = { q: "", status: "", fac: "", turma: "", papel: "", sort: "" };

type FilterableUser = {
  name: string;
  cpf: string;
  email: string;
  phone: string | null;
  registrationCode: string | null;
  isActive: boolean;
  isArchived?: boolean;
  role: string | null;
  facultyId: string | null;
  facultyAbbr: string | null;
  baseCode: string | null;
  createdAt?: string;
  allRoles?: Array<{ role: string; facultyId: string | null; cohortId: string | null }>;
};

export function filterUsers<T extends FilterableUser>(users: T[], f: UserFilters): T[] {
  const q = f.q.trim().toLowerCase();
  const out = users.filter((u) => {
    if (f.status === "active" && (!u.isActive || u.isArchived)) return false;
    if (f.status === "pending" && u.isActive) return false;
    if (f.status === "archived" && !u.isArchived) return false;
    if (f.fac && !(u.facultyId === f.fac || u.allRoles?.some((r) => r.facultyId === f.fac))) return false;
    if (f.turma && !u.allRoles?.some((r) => r.cohortId === f.turma)) return false;
    if (f.papel && !(u.role === f.papel || u.allRoles?.some((r) => r.role === f.papel))) return false;
    if (!q) return true;
    return [u.name, u.cpf ?? "", u.email, u.phone ?? "", u.registrationCode ?? "", u.role ?? "", u.facultyAbbr ?? "", u.baseCode ?? ""]
      .some((v) => v.toLowerCase().includes(q));
  });
  if (f.sort === "newest" || f.sort === "oldest") {
    out.sort((a, b) => {
      const cmp = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return f.sort === "newest" ? -cmp : cmp;
    });
  } else {
    out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }
  return out;
}

export function countActiveFilters(f: UserFilters): number {
  return [f.status, f.fac, f.turma, f.papel].filter(Boolean).length;
}
