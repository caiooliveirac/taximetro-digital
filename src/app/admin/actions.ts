"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  executeManualAttendance,
  manualAttendanceSchema,
} from "@/features/admin-attendance/application/use-cases/handle-manual-attendance";

export type ManualAttendanceResult =
  | { success: true; data: { leaderNotificationsSent?: number } }
  | { success: false; error: string };

export async function manualAttendanceAction(input: unknown): Promise<ManualAttendanceResult> {
  const session = await auth();
  const sessionUser = session?.user as { id?: string; name?: string | null; role?: string } | undefined;

  if (!sessionUser || sessionUser.role !== "COORDINATOR") {
    return { success: false, error: "Sem permissão" };
  }

  const parsed = manualAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Dados inválidos" };
  }

  try {
    const result = await executeManualAttendance({
      actor: { id: sessionUser.id ?? "", name: sessionUser.name ?? null },
      input: parsed.data,
    });

    revalidatePath("/admin");

    if (!result.body.success) {
      return { success: false, error: result.body.error ?? "Falha ao processar" };
    }
    return { success: true, data: result.body.data ?? {} };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Falha interna ao processar presença manual",
    };
  }
}
