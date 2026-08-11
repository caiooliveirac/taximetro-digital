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

export type HistoryAssignment = {
  id: string;
  date: string;
  period: string;
  assignment_status: string;
  base_code: string;
  base_name: string;
  checkin_status: string | null;
  geo_valid: boolean | null;
  checkin_method: string | null;
  checkin_at: string | null;
  checkout_at: string | null;
};

export type HistoryRequest = {
  id: string;
  type: string;
  status: string;
  created_at: string;
  review_notes: string | null;
  assignment_date: string | null;
  base_code: string | null;
  extra_base_code: string | null;
  extra_date: string | null;
  extra_period: string | null;
};

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

const OUTCOME_LABEL: Record<string, string> = {
  SCHEDULED: "Agendado",
  CONFIRMED: "Confirmado",
  CHECKED_IN: "Presente",
  CHECKED_OUT: "Finalizado",
  ABSENT: "Ausente",
  CANCELLED: "Cancelado",
};

const OUTCOME_COLOR: Record<string, string> = {
  SCHEDULED: "",
  CONFIRMED: "bg-blue-50",
  CHECKED_IN: "bg-emerald-50",
  CHECKED_OUT: "bg-emerald-50",
  ABSENT: "bg-red-50",
  CANCELLED: "bg-slate-50",
};

export function getRowOutcome(a: HistoryAssignment): { label: string; bg: string } {
  if (a.assignment_status === "ABSENT") return { label: "Ausente", bg: "bg-red-50" };
  if (a.geo_valid === false) return { label: "Erro geolocalização", bg: "bg-purple-50" };
  if (a.checkin_status === "EXPIRED") return { label: "TOTP expirado", bg: "bg-violet-50" };
  if (a.checkin_status === "REJECTED") return { label: "Erro QR", bg: "bg-fuchsia-50" };
  return {
    label: OUTCOME_LABEL[a.assignment_status] ?? a.assignment_status,
    bg: OUTCOME_COLOR[a.assignment_status] ?? "",
  };
}

export const REQ_TYPE_LABEL: Record<string, string> = { SWAP: "Troca", EXTRA_SHIFT: "Extra", DROP_SHIFT: "Descarte" };
export const REQ_STATUS_LABEL: Record<string, string> = { PENDING: "Pendente", APPROVED: "Aprovada", REJECTED: "Rejeitada" };
export const REQ_STATUS_COLOR: Record<string, string> = { PENDING: "bg-amber-50 text-amber-700", APPROVED: "bg-emerald-50 text-emerald-700", REJECTED: "bg-red-50 text-red-700" };

export function formatCpf(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}
