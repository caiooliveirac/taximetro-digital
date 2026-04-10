import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import {
    executeReassignAssignmentBase,
    reassignAssignmentSchema,
} from "@/features/scheduling/application/use-cases/reassign-assignment-base";

export async function PATCH(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user || !["COORDINATOR", "LEADER"].includes(user.role)) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = reassignAssignmentSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.message }, { status: 400 });
    }

    const result = await executeReassignAssignmentBase({
        actor: {
            id: user.id,
            role: user.role,
            facultyId: user.facultyId,
            isImpersonating: user.isImpersonating,
            realUserId: user.realUserId,
        },
        input: parsed.data,
    });

    return NextResponse.json(result.body, { status: result.status });
}