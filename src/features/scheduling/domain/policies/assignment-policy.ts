export function canLeaderManageFaculty(params: {
  actorRole: string;
  actorFacultyId: string | null;
  targetFacultyId: string;
}) {
  if (params.actorRole !== "LEADER") return true;
  return params.actorFacultyId === params.targetFacultyId;
}

export function canMutateAssignments(actorRole: string) {
  return actorRole === "COORDINATOR" || actorRole === "LEADER";
}
