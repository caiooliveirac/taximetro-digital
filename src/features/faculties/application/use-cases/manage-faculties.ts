import { z } from "zod/v4";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  createFaculty,
  listFaculties,
  updateFacultyById,
} from "@/features/faculties/infra/repositories/faculty-repository";

export const facultySchema = z.object({
  name: z.string().min(2).max(100),
  abbreviation: z.string().min(2).max(10),
  targetHours: z.number().int().min(0).default(0),
  targetShifts: z.number().int().min(0).default(0),
  targetShiftsPerWeek: z.number().int().min(0).default(0),
  targetUSAsPerWeek: z.number().int().min(0).default(0),
  targetCRUsPerWeek: z.number().int().min(0).default(0),
  targetCRLsPerWeek: z.number().int().min(0).default(0),
  totalInterns: z.number().int().min(0).default(0),
  rotationStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function executeListFaculties() {
  return listFaculties();
}

export async function executeCreateFaculty(params: {
  actorUserId: string;
  input: z.infer<typeof facultySchema>;
}) {
  const created = await createFaculty(params.input);

  await logAudit({
    userId: params.actorUserId,
    action: "CREATE_FACULTY",
    entity: "faculty",
    entityId: created.id,
    payload: params.input,
  });

  return { status: 201, body: { success: true, data: created } } as const;
}

export async function executeUpdateFaculty(params: {
  actorUserId: string;
  facultyId: string;
  input: Partial<z.infer<typeof facultySchema>>;
}) {
  const updated = await updateFacultyById({
    id: params.facultyId,
    values: params.input,
  });

  if (!updated) {
    return { status: 404, body: { success: false, error: "Faculdade não encontrada" } } as const;
  }

  await logAudit({
    userId: params.actorUserId,
    action: "UPDATE_FACULTY",
    entity: "faculty",
    entityId: params.facultyId,
    payload: params.input,
  });

  return { status: 200, body: { success: true, data: updated } } as const;
}
