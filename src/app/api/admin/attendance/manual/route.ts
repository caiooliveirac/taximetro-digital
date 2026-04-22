import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
    executeManualAttendance,
    manualAttendanceSchema,
} from "@/features/admin-attendance/application/use-cases/handle-manual-attendance";

async function requireCoordinator(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
    if (!token || token.role !== "COORDINATOR") return null;
    return token;
}

export async function POST(req: NextRequest) {
    const token = await requireCoordinator(req);
    if (!token) {
        return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ success: false, error: "Corpo inválido" }, { status: 400 });
    }

    const parsed = manualAttendanceSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
    }

    try {
        const result = await executeManualAttendance({
            actor: { id: token.id as string, name: token.name },
            input: parsed.data,
        });

        return NextResponse.json(result.body, { status: result.status });
    } catch (error) {
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Falha interna ao processar presença manual",
            },
            { status: 500 },
        );
    }
}