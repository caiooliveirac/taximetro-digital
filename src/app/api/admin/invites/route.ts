import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
    createAdminInviteSchema,
    executeCreateAdminInviteLink,
} from "@/features/user-management/application/use-cases/create-admin-invite-link";

async function requireCoordinator(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === "production" });
    if (!token || token.role !== "COORDINATOR") return null;
    return token;
}

export async function POST(req: NextRequest) {
    const token = await requireCoordinator(req);
    if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const parsed = createAdminInviteSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }

    try {
        const result = await executeCreateAdminInviteLink({
            actorUserId: token.id as string,
            input: parsed.data,
            authUrl: process.env.AUTH_URL,
        });
        return NextResponse.json(result.body, { status: result.status });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("created_by") || (typeof (err as Record<string, unknown>).code === "string" && (err as Record<string, unknown>).code === "23503")) {
            return NextResponse.json({ success: false, error: "Sessão inválida. Faça logout e login novamente." }, { status: 401 });
        }
        throw err;
    }
}
