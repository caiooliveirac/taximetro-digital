import { listPendingPhotoChangeRequestsRows, listPendingUsersRows } from "@/features/user-management/infra/repositories/user-management-repository";

type Actor = {
  role: string;
  facultyId: string | null;
};

export async function executeListPendingUsers(actor: Actor) {
  const rows = await listPendingUsersRows();

  if (actor.role === "LEADER") {
    return rows.filter((r) => r.facultyId === actor.facultyId && r.role === "INTERN");
  }

  return rows;
}

export async function executeListPendingPhotoChangeRequests(actor: Actor) {
  const rows = await listPendingPhotoChangeRequestsRows();

  if (actor.role === "LEADER") {
    return rows.filter((r) => r.facultyId === actor.facultyId);
  }

  return rows;
}
