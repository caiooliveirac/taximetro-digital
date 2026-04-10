import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
    absenceJustificationSchema,
    executeSaveAbsenceJustification,
} from "@/features/scheduling/application/use-cases/save-absence-justification";

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const user = await getEffectiveUser(req);
    if (!user || !["COORDINATOR", "LEADER", "INTERN"].includes(user.role)) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = absenceJustificationSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Justificativa inválida" }, { status: 400 });
    }

    const { id } = await params;
    const result = await executeSaveAbsenceJustification({
        actor: {
            id: user.id,
            role: user.role,
            facultyId: user.facultyId,
            isImpersonating: user.isImpersonating,
            realUserId: user.realUserId,
        },
        assignmentId: id,
        input: parsed.data,
    });

    return NextResponse.json(result.body, { status: result.status });
}