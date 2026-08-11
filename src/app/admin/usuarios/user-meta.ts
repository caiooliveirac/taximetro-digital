// Tipos e rótulos compartilhados entre a lista (page.tsx) e o drawer de detalhe.

export type User = {
  id: string;
  name: string;
  cpf: string;
  email: string;
  phone: string | null;
  registrationCode: string | null;
  isActive: boolean;
  isArchived?: boolean;
  selfie: string | null;
  role: string | null;
  facultyId: string | null;
  facultyAbbr: string | null;
  baseId: string | null;
  baseCode: string | null;
  alsoPreceptor?: boolean;
  createdAt?: string;
  allRoles?: Array<{
    id: string | null;
    role: "COORDINATOR" | "LEADER" | "PRECEPTOR" | "INTERN";
    facultyId: string | null;
    facultyAbbr: string | null;
    baseId: string | null;
    baseCode: string | null;
    cohortId: string | null;
    cohortName: string | null;
  }>;
};

export type Faculty = { id: string; abbreviation: string };
export type Base = { id: string; code: string; name: string };
export type Cohort = { id: string; facultyId: string; name: string | null; label: string; status: string };

export const ROLES = ["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"] as const;
export const ROLE_LABEL: Record<string, string> = {
  COORDINATOR: "Coordenador",
  LEADER: "Líder de Escala",
  PRECEPTOR: "Preceptor",
  INTERN: "Interno",
};

export const ROLE_BADGE_CLASS: Record<string, string> = {
  COORDINATOR: "bg-purple-50 text-purple-700",
  LEADER: "bg-emerald-50 text-emerald-700",
  PRECEPTOR: "bg-amber-50 text-amber-700",
  INTERN: "bg-blue-50 text-blue-700",
};

export function formatCpf(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
