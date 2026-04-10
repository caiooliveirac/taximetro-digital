import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeGenerateCruFixedWeek, generateCruFixedWeekSchema } from "@/features/scheduling/application/use-cases/generate-cru-fixed-week";

/**
 * POST — Materialize CRU fixed assignments for a given week.
 * Creates real assignments from active templates.
 */
export async function POST(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = generateCruFixedWeekSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Data inválida" }, { status: 400 });
    }

    const result = await executeGenerateCruFixedWeek({
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
