/**
 * POST /api/intern/aviso — o interno aperta um botão no plantão de hoje e a
 * coordenação recebe no WhatsApp, via secretário `tom`.
 *
 * Só o plantão do próprio interno, só o de hoje (operacional), e só em status
 * em que ele pode estar na base. Toque repetido do mesmo botão no mesmo
 * plantão dentro de 30 min é ignorado com sucesso: o dedo tremeu, não a base.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, bases, faculties, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser } from "@/lib/impersonate";
import { formatBrazilTime, isCurrentOperationalAssignment } from "@/lib/utils";
import { avisarSecretario, textoDoAviso, TIPOS_DE_AVISO } from "@/lib/aviso-tom";

const schema = z.object({
  assignmentId: z.string().uuid(),
  tipo: z.enum(Object.keys(TIPOS_DE_AVISO) as [keyof typeof TIPOS_DE_AVISO, ...(keyof typeof TIPOS_DE_AVISO)[]]),
});

const STATUS_NA_BASE = new Set(["SCHEDULED", "CONFIRMED", "CHECKED_IN"]);
const REPETICAO_MS = 30 * 60_000;
// ponytail: memória do processo; se um dia houver mais de uma réplica, mover para o audit_logs.
const ultimos = new Map<string, number>();

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }
  const { assignmentId, tipo } = parsed.data;

  const [plantao] = await db
    .select({
      id: assignments.id,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
      baseCode: bases.code,
      interno: users.name,
      faculdade: faculties.name,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .leftJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, user.id)))
    .limit(1);

  if (!plantao) return NextResponse.json({ success: false, error: "Plantão não encontrado" }, { status: 404 });
  if (!STATUS_NA_BASE.has(plantao.status) || !isCurrentOperationalAssignment(plantao.date, plantao.period)) {
    return NextResponse.json({ success: false, error: "O aviso só vale para o plantão em andamento." }, { status: 409 });
  }

  const chave = `${assignmentId}:${tipo}`;
  const agora = Date.now();
  if (agora - (ultimos.get(chave) ?? 0) < REPETICAO_MS) {
    return NextResponse.json({ success: true, data: { entregue: true, repetido: true } });
  }
  ultimos.set(chave, agora);

  const texto = textoDoAviso({
    tipo,
    interno: plantao.interno,
    faculdade: plantao.faculdade,
    baseCode: plantao.baseCode,
    hora: formatBrazilTime(new Date()),
  });
  const entregue = await avisarSecretario(texto);

  await logAudit({
    userId: user.realUserId ?? user.id,
    action: "INTERN_ALERT_SENT",
    entity: "assignment",
    entityId: assignmentId,
    payload: { tipo, entregue },
  });

  return NextResponse.json({ success: true, data: { entregue } });
}
