import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { inviteLinks, faculties, bases } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";
import { z } from "zod/v4";

const VALID_ROLES = ["COORDINATOR", "LEADER", "PRECEPTOR", "INTERN"] as const;

const createSchema = z.object({
    targetRole: z.enum(VALID_ROLES),
    facultyId: z.string().uuid().optional(),
    baseId: z.string().uuid().optional(),
}).refine(
    (d) => {
        if (d.targetRole === "INTERN" || d.targetRole === "LEADER") return !!d.facultyId;
        if (d.targetRole === "PRECEPTOR") return !!d.baseId;
        return true;
    },
    { message: "Faculdade obrigatória para Interno/Líder, Base obrigatória para Preceptor" },
);

async function requireCoordinator(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });
    if (!token || token.role !== "COORDINATOR") return null;
    return token;
}

export async function POST(req: NextRequest) {
    const token = await requireCoordinator(req);
    if (!token) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
    }

    const { targetRole, facultyId, baseId } = parsed.data;

    // Validate that facultyId / baseId actually exist
    if (facultyId) {
        const [f] = await db.select({ id: faculties.id }).from(faculties).where(eq(faculties.id, facultyId));
        if (!f) return NextResponse.json({ success: false, error: "Faculdade não encontrada" }, { status: 400 });
    }
    if (baseId) {
        const [b] = await db.select({ id: bases.id }).from(bases).where(eq(bases.id, baseId));
        if (!b) return NextResponse.json({ success: false, error: "Base não encontrada" }, { status: 400 });
    }

    const linkToken = randomBytes(16).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    try {
        const [link] = await db.insert(inviteLinks).values({
            token: linkToken,
            targetRole,
            createdBy: token.id as string,
            facultyId: facultyId ?? null,
            baseId: baseId ?? null,
            expiresAt,
        }).returning();

        await logAudit({
            userId: token.id as string,
            action: "CREATE_INVITE",
            entity: "invite_link",
            entityId: link.id,
            payload: { targetRole, facultyId, baseId },
        });

        const baseUrl = (process.env.AUTH_URL ?? "https://mnrs.com.br").replace(/\/$/, "");

        return NextResponse.json({
            success: true,
            data: {
                id: link.id,
                token: link.token,
                targetRole,
                url: `${baseUrl}/taximetro/registro/${link.token}`,
                expiresAt: link.expiresAt,
            },
        }, { status: 201 });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("created_by") || (typeof (err as Record<string, unknown>).code === "string" && (err as Record<string, unknown>).code === "23503")) {
            return NextResponse.json({ success: false, error: "Sessão inválida. Faça logout e login novamente." }, { status: 401 });
        }
        throw err;
    }
}
