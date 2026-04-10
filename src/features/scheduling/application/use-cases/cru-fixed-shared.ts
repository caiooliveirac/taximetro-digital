export const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

export type SchedulingActor = {
  id: string;
  role: string;
  facultyId: string | null;
  isImpersonating: boolean;
  realUserId: string | null;
};

export function canManageCruFixed(actor: SchedulingActor) {
  return ["LEADER", "COORDINATOR"].includes(actor.role) && Boolean(actor.facultyId);
}
