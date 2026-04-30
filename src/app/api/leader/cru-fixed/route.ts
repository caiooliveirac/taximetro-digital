import { NextRequest, NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/impersonate";
import { executeListCruFixed } from "@/features/scheduling/application/use-cases/list-cru-fixed";
import { addCruFixedSchema, executeAddCruFixed, executeRemoveCruFixed } from "@/features/scheduling/application/use-cases/add-cru-fixed";
import { z } from "zod/v4";

/** GET — list active CRU fixed assignments for leader's faculty */
export async function GET(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const result = await executeListCruFixed({
        actor: {
            id: user.id,
            role: user.role,
            facultyId: user.facultyId,
            isImpersonating: user.isImpersonating,
            realUserId: user.realUserId,
        },
    });

    return NextResponse.json(result.body, { status: result.status });
}

/** POST — add an intern to a fixed CRU slot */
export async function POST(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = addCruFixedSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
    }

    const result = await executeAddCruFixed({
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

/** DELETE — remove an intern from a fixed CRU slot */
export async function DELETE(req: NextRequest) {
    const user = await getEffectiveUser(req);
    if (!user) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const id = searchParams.get("id");
    if (!id || !z.string().uuid().safeParse(id).success) {
        return NextResponse.json({ success: false, error: "ID inválido" }, { status: 400 });
    }

    const result = await executeRemoveCruFixed({
        actor: {
            id: user.id,
            role: user.role,
            facultyId: user.facultyId,
            isImpersonating: user.isImpersonating,
            realUserId: user.realUserId,
        },
        id,
    });

    return NextResponse.json(result.body, { status: result.status });
}
