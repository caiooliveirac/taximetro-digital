import { z } from "zod/v4";
import {
  countCaseRecordsForAssignment,
  createCaseRecord,
} from "@/features/case-records/infra/repositories/case-record-repository";

export const createCaseRecordSchema = z.object({
  assignmentId: z.string().uuid(),
  nickname: z.string().min(1).max(100),
  description: z.string().optional(),
});

export async function executeCreateCaseRecord(params: {
  actorId: string;
  input: z.infer<typeof createCaseRecordSchema>;
}) {
  const count = await countCaseRecordsForAssignment(params.input.assignmentId);
  const caseNumber = String(count + 1).padStart(4, "0");

  const created = await createCaseRecord({
    assignmentId: params.input.assignmentId,
    internId: params.actorId,
    caseNumber,
    nickname: params.input.nickname,
    description: params.input.description ?? null,
  });

  return { status: 201, body: { success: true, data: created } } as const;
}
