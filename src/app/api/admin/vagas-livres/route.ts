/**
 * Liberação automática de vagas (ver auto-release-slots.ts).
 * GET: configuração e turmas por faculdade. PUT: salva uma faculdade e roda o
 * job. POST: roda o job agora.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEffectiveUser } from "@/lib/impersonate";
import { bloqueioDeFeature } from "@/lib/feature-gate";
import {
  executeAutoReleaseSlots,
  getAutoReleaseOverview,
  saveAutoReleaseSettings,
} from "@/features/scheduling/application/use-cases/auto-release-slots";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  facultyId: z.string().uuid(),
  enabled: z.boolean(),
  deadlineDays: z.number().int().min(0).max(30),
});

async function coordenador(req: NextRequest) {
  const user = await getEffectiveUser(req);
  return user && user.role === "COORDINATOR" ? user : null;
}

const semPermissao = () => NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });

export async function GET(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("liberacaoAutomatica");
  if (bloqueio) return bloqueio;
  if (!(await coordenador(req))) return semPermissao();
  return NextResponse.json({ success: true, data: await getAutoReleaseOverview() });
}

export async function PUT(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("liberacaoAutomatica");
  if (bloqueio) return bloqueio;
  const user = await coordenador(req);
  if (!user) return semPermissao();
  const parsed = settingsSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Dados inválidos" }, { status: 400 });
  }
  await saveAutoReleaseSettings({ actorId: user.realUserId ?? user.id, ...parsed.data });
  const run = await executeAutoReleaseSlots();
  return NextResponse.json({ success: true, data: { run, overview: await getAutoReleaseOverview() } });
}

export async function POST(req: NextRequest) {
  const bloqueio = bloqueioDeFeature("liberacaoAutomatica");
  if (bloqueio) return bloqueio;
  if (!(await coordenador(req))) return semPermissao();
  const run = await executeAutoReleaseSlots();
  return NextResponse.json({ success: true, data: { run, overview: await getAutoReleaseOverview() } });
}
