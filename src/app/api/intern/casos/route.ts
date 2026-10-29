/**
 * /api/intern/casos — casos clínicos do Dai, texto pronto (ver src/lib/dai-casos.ts).
 *
 * GET              → { temas }  quantos casos cada tema tem e quantos ele já abriu
 * GET ?tema=AVC    → { caso }   próximo caso do tema, FECHADO (sem nome nem resposta)
 * POST { id, tentativa } → { caso } ABERTO; registra DAI_CASO_ABERTO no audit_log
 *
 * Nenhuma chamada ao modelo, então fica fora do teto de perguntas do Dai.
 * A tentativa não é guardada: só serve para obrigar a pensar antes.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getEffectiveUser } from "@/lib/impersonate";
import { logAudit } from "@/lib/audit";
import { AUDIT_CASO_ABERTO, TENTATIVA_MIN, abrir, casoPorId, fechar, proximoCaso, resumoDosTemas } from "@/lib/dai-casos";

async function quem(req: NextRequest) {
  const user = await getEffectiveUser(req);
  return user && (user.role === "INTERN" || user.role === "LEADER") ? user : null;
}

async function abertos(userId: string): Promise<string[]> {
  const rows = await db
    .select({ payload: auditLog.payload })
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.action, AUDIT_CASO_ABERTO)))
    .orderBy(asc(auditLog.createdAt));
  return rows.map((r) => String((r.payload as { caso?: string } | null)?.caso ?? "")).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const user = await quem(req);
  if (!user) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const tema = req.nextUrl.searchParams.get("tema");
  const vistos = await abertos(user.id);
  if (!tema) return NextResponse.json({ success: true, data: { temas: resumoDosTemas(vistos) } });

  const caso = proximoCaso(tema, vistos, req.nextUrl.searchParams.get("pular") ?? undefined);
  if (!caso) return NextResponse.json({ success: false, error: "Não há casos desse tema." }, { status: 404 });
  return NextResponse.json({ success: true, data: { caso: fechar(caso) } });
}

const pedido = z.object({ id: z.string().max(120), tentativa: z.string().trim().min(TENTATIVA_MIN).max(4000) });

export async function POST(req: NextRequest) {
  const user = await quem(req);
  if (!user) return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

  const parsed = pedido.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: `Escreva sua conduta (pelo menos ${TENTATIVA_MIN} caracteres) antes de ver a resposta.` }, { status: 400 });
  }
  const caso = casoPorId(parsed.data.id);
  if (!caso) return NextResponse.json({ success: false, error: "Caso não encontrado." }, { status: 404 });

  // Personificando, só olha: não conta como caso visto pelo interno.
  if (!user.realUserId) {
    await logAudit({ userId: user.id, action: AUDIT_CASO_ABERTO, entity: "dai_caso", payload: { caso: caso.id, tema: caso.tema } }).catch(() => {});
  }
  return NextResponse.json({ success: true, data: { caso: abrir(caso) } });
}
