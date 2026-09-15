/**
 * Remanejamento pelo próprio interno, no plantão em andamento.
 *
 * GET  ?assignmentId=  — a grade de hoje inteira: cada USA com suas células
 *                        (quem está lá, com ou sem check-in, e as livres), o
 *                        médico presente e a desativação (quando o canal com o
 *                        `plantoes` existe), o aviso de problema dado no turno,
 *                        e a base irmã (mesmo endereço) como sugestão.
 * POST {assignmentId, newBaseId} — ocupa uma célula livre na hora e avisa a
 *                        coordenação.
 *
 * Só depois de um aviso (sem médico / sem enfermeiro / viatura) neste mesmo
 * plantão: o aviso é o gatilho, e é o que impede virar "mudo para a base perto
 * de casa". Pode repetir no mesmo plantão — ele pode ter se enganado de base.
 * Vale antes ou depois do check-in: o caso real é o interno que já chegou e
 * encontrou a base parada.
 *
 * Base com aviso de problema neste turno, ou desativada pelo chefe de plantão
 * no `plantoes`, não oferece célula livre: o aviso do interno já fecha a base
 * dele para os outros.
 *
 * Tolerâncias, contadas do início real do turno (07:00 / 19:00): a grade só
 * abre aos 10 min, para quem ainda vai chegar fazer check-in e travar a própria
 * vaga; aos 15 min, escalado sem check-in continua visível mas a vaga dele
 * pode ser ocupada por quem procura.
 *
 * A vaga é ocupada dentro de um advisory lock por (base, data, turno): dois
 * internos correndo para a mesma vaga entram um de cada vez, e o segundo já
 * não a encontra. O remanejamento em si é o mesmo caso de uso do admin/líder,
 * que grava a nota [REMANEJADO] e o audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, auditLog, bases, faculties, slotRules, users } from "@/db/schema";
import { getEffectiveUser, type EffectiveUser } from "@/lib/impersonate";
import { getDayOfWeek } from "@/lib/slots";
import { formatBrazilTime, getBrazilNowParts, isCurrentOperationalAssignment } from "@/lib/utils";
import { avisarSecretario, STATUS_NA_BASE, TIPOS_DE_AVISO, type TipoDeAviso } from "@/lib/aviso-tom";
import {
  ABERTURA_MIN,
  REIVINDICACAO_MIN,
  celulaOcupavel,
  celulasDaBase,
  compararCodigoDeBase,
  horaDoTurno,
  mesmoEndereco,
  minutosDesdeInicioDoTurno,
  motivoDoRemanejamento,
  textoDoRemanejamento,
  type Ocupante,
} from "@/lib/remanejamento-interno";
import {
  canalDoPlantoesConfigurado,
  estadoDasBasesNoPlantoes,
} from "@/features/scheduling/infra/repositories/plantoes-medicos-repository";
import { executeReassignAssignmentBase } from "@/features/scheduling/application/use-cases/reassign-assignment-base";

type Plantao = {
  id: string;
  baseId: string;
  baseCode: string;
  latitude: number;
  longitude: number;
  date: string;
  period: "DAY" | "NIGHT";
  status: string;
  isExtraShift: boolean;
  interno: string;
  faculdade: string | null;
};

type Falha = { status: number; error: string };

async function plantaoEmAndamento(user: EffectiveUser, assignmentId: string): Promise<Plantao | Falha> {
  const [plantao] = await db
    .select({
      id: assignments.id,
      baseId: assignments.baseId,
      baseCode: bases.code,
      latitude: bases.latitude,
      longitude: bases.longitude,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
      isExtraShift: assignments.isExtraShift,
      interno: users.name,
      faculdade: faculties.name,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .leftJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, user.id)))
    .limit(1);

  if (!plantao) return { status: 404, error: "Plantão não encontrado" };
  if (!STATUS_NA_BASE.has(plantao.status) || !isCurrentOperationalAssignment(plantao.date, plantao.period)) {
    return { status: 409, error: "O remanejamento só vale para o plantão em andamento." };
  }
  if (plantao.isExtraShift) {
    return { status: 409, error: "Plantão extra não pode ser remanejado pelo interno." };
  }
  return plantao;
}

/** Último aviso deste plantão, ou null: sem aviso não há remanejamento. */
async function ultimoAviso(assignmentId: string): Promise<string | null> {
  const [aviso] = await db
    .select({ payload: auditLog.payload })
    .from(auditLog)
    .where(and(eq(auditLog.action, "INTERN_ALERT_SENT"), eq(auditLog.entityId, assignmentId)))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  if (!aviso) return null;
  const tipo = (aviso.payload as { tipo?: string } | null)?.tipo;
  return tipo ?? "";
}

const SEM_AVISO = "Avise a coordenação primeiro (sem médico, sem enfermeiro ou problema na viatura).";

/**
 * Avisos de problema dados neste dia/turno, o mais recente por base. A base
 * vem do payload do aviso, não do plantão: o plantão pode ter sido remanejado
 * depois, e o aviso continua sendo da base onde foi dado.
 */
async function avisosDoTurno(plantao: Plantao): Promise<Map<string, { tipo: string; hora: string }>> {
  const linhas = await db
    .select({
      baseId: sql<string | null>`${auditLog.payload}->>'baseId'`,
      tipo: sql<string | null>`${auditLog.payload}->>'tipo'`,
      // created_at é timestamp sem fuso preenchido por now() na sessão do banco
      // (America/Sao_Paulo no servidor); lido como Date vira UTC e atrasa 3h.
      // Formatar no SQL usa a hora como foi gravada.
      hora: sql<string>`to_char(${auditLog.createdAt}, 'HH24:MI')`,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "INTERN_ALERT_SENT"),
        sql`${auditLog.payload}->>'date' = ${plantao.date}`,
        sql`${auditLog.payload}->>'period' = ${plantao.period}`,
      ),
    )
    .orderBy(desc(auditLog.createdAt));
  const porBase = new Map<string, { tipo: string; hora: string }>();
  for (const l of linhas) {
    if (!l.baseId || porBase.has(l.baseId)) continue;
    const tipo = l.tipo && l.tipo in TIPOS_DE_AVISO ? TIPOS_DE_AVISO[l.tipo as TipoDeAviso] : "problema na base";
    porBase.set(l.baseId, { tipo, hora: l.hora });
  }
  return porBase;
}

/**
 * A grade de hoje, base por base: quantas células tem cada USA neste turno
 * (soma de slot_rules de todas as faculdades), quem já está em cada uma, e o
 * que fecha a base para quem vem de fora. Consultas por conjunto, não por base.
 */
async function gradeDoTurno(plantao: Plantao, reivindicarSemCheckin: boolean) {
  const dayOfWeek = getDayOfWeek(plantao.date);

  const [capacidade, ocupantes, usas, avisos] = await Promise.all([
    db
      .select({ baseId: slotRules.baseId, capacity: sql<number>`COALESCE(SUM(${slotRules.capacity}), 0)` })
      .from(slotRules)
      .where(
        and(
          eq(slotRules.dayOfWeek, dayOfWeek),
          eq(slotRules.period, plantao.period),
          eq(slotRules.isActive, true),
          eq(slotRules.isBlocked, false),
          eq(slotRules.isExtraShift, false),
        ),
      )
      .groupBy(slotRules.baseId),
    db
      .select({
        baseId: assignments.baseId,
        faculdade: faculties.abbreviation,
        status: assignments.status,
        // O caso de uso de remanejamento anota [REMANEJADO]; quem chegou assim já conta como presente.
        remanejado: sql<boolean>`COALESCE(${assignments.notes}, '') LIKE '%[REMANEJADO]%'`,
      })
      .from(assignments)
      .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
      .where(
        and(
          eq(assignments.date, plantao.date),
          eq(assignments.period, plantao.period),
          eq(assignments.isExtraShift, false),
          notInArray(assignments.status, ["CANCELLED", "ABSENT"]),
        ),
      )
      .orderBy(assignments.createdAt),
    db
      .select({ id: bases.id, code: bases.code, name: bases.name, latitude: bases.latitude, longitude: bases.longitude })
      .from(bases)
      .where(and(eq(bases.type, "USA"), eq(bases.isActive, true))),
    avisosDoTurno(plantao),
  ]);
  const capacidadePorBase = new Map(capacidade.map((c) => [c.baseId, Number(c.capacity)]));
  const ocupantesPorBase = new Map<string, Ocupante[]>();
  for (const o of ocupantes) ocupantesPorBase.set(o.baseId, [...(ocupantesPorBase.get(o.baseId) ?? []), o]);

  const plantoes = await estadoDasBasesNoPlantoes(usas.map((b) => b.code));

  return usas
    .sort((a, b) => compararCodigoDeBase(a.code, b.code))
    .map((base) => {
      const aviso = avisos.get(base.id) ?? null;
      const desativada = plantoes.desativadas[base.code] ?? null;
      return {
        id: base.id,
        code: base.code,
        name: base.name,
        atual: base.id === plantao.baseId,
        irma: base.id !== plantao.baseId && mesmoEndereco(base, plantao),
        aviso,
        desativada: desativada
          ? { ...desativada, desde: desativada.desde ? formatBrazilTime(new Date(desativada.desde)) : null }
          : null,
        medicos: plantoes.medicos[base.code] ?? [],
        celulas: celulasDaBase(capacidadePorBase.get(base.id) ?? 0, ocupantesPorBase.get(base.id) ?? [], {
          bloqueada: aviso !== null || desativada !== null,
          reivindicarSemCheckin,
        }),
      };
    });
}

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const assignmentId = req.nextUrl.searchParams.get("assignmentId") ?? "";
  if (!z.string().uuid().safeParse(assignmentId).success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }

  const plantao = await plantaoEmAndamento(user, assignmentId);
  if ("error" in plantao) return NextResponse.json({ success: false, error: plantao.error }, { status: plantao.status });
  if ((await ultimoAviso(plantao.id)) === null) {
    return NextResponse.json({ success: false, error: SEM_AVISO }, { status: 409 });
  }

  const minutos = minutosDesdeInicioDoTurno(plantao.period, getBrazilNowParts());
  const tolerancia = {
    abreAs: horaDoTurno(plantao.period, ABERTURA_MIN),
    reivindicaAs: horaDoTurno(plantao.period, REIVINDICACAO_MIN),
    aberta: minutos >= ABERTURA_MIN,
    reivindicando: minutos >= REIVINDICACAO_MIN,
  };
  if (!tolerancia.aberta) {
    return NextResponse.json({ success: true, data: { ...tolerancia, medicosDisponiveis: false, bases: [] } });
  }

  return NextResponse.json({
    success: true,
    data: {
      ...tolerancia,
      medicosDisponiveis: canalDoPlantoesConfigurado(),
      bases: await gradeDoTurno(plantao, tolerancia.reivindicando),
    },
  });
}

const postSchema = z.object({
  assignmentId: z.string().uuid(),
  newBaseId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "INTERN") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }
  const { assignmentId, newBaseId } = parsed.data;

  const plantao = await plantaoEmAndamento(user, assignmentId);
  if ("error" in plantao) return NextResponse.json({ success: false, error: plantao.error }, { status: plantao.status });
  const tipo = await ultimoAviso(plantao.id);
  if (tipo === null) return NextResponse.json({ success: false, error: SEM_AVISO }, { status: 409 });
  const motivo = motivoDoRemanejamento(tipo);

  const minutos = minutosDesdeInicioDoTurno(plantao.period, getBrazilNowParts());
  if (minutos < ABERTURA_MIN) {
    return NextResponse.json(
      { success: false, error: `A grade de vagas abre às ${horaDoTurno(plantao.period, ABERTURA_MIN)}.` },
      { status: 409 },
    );
  }
  const reivindicando = minutos >= REIVINDICACAO_MIN;

  // O lock vive nesta transação; o caso de uso escreve pela conexão do pool,
  // mas só depois de o lock ser nosso, e o update dele já está commitado quando
  // o lock solta. Quem vier depois lê a célula já ocupada.
  const chave = `remanejamento:${newBaseId}:${plantao.date}:${plantao.period}`;
  const resultado = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${chave}))`);

    const destino = (await gradeDoTurno(plantao, reivindicando)).find((b) => b.id === newBaseId);
    if (!destino) return { status: 404, body: { success: false, error: "Base de destino inválida" } } as const;
    if (destino.desativada) {
      const desde = destino.desativada.desde ? ` desde ${destino.desativada.desde}` : "";
      return { status: 409, body: { success: false, error: `A ${destino.code} está desativada no plantões${desde}.` } } as const;
    }
    if (destino.aviso) {
      return { status: 409, body: { success: false, error: `A ${destino.code} tem aviso de ${destino.aviso.tipo} às ${destino.aviso.hora}.` } } as const;
    }
    if (!destino.celulas.some(celulaOcupavel)) {
      return { status: 409, body: { success: false, error: `A ${destino.code} já não tem vaga neste turno.` } } as const;
    }

    const remanejado = await executeReassignAssignmentBase({
      actor: {
        id: user.id,
        role: user.role,
        facultyId: user.facultyId,
        isImpersonating: user.isImpersonating,
        realUserId: user.realUserId,
      },
      input: {
        assignmentId: plantao.id,
        newBaseId: destino.id,
        reason: `Remanejamento pelo interno: ${motivo}`,
        authorized: true,
        apenasComCheckin: reivindicando,
      },
    });
    return { ...remanejado, baseCode: destino.code };
  });

  if (resultado.status !== 200) return NextResponse.json(resultado.body, { status: resultado.status });

  const entregue = await avisarSecretario(
    textoDoRemanejamento({
      interno: plantao.interno,
      faculdade: plantao.faculdade,
      de: plantao.baseCode,
      para: resultado.baseCode,
      hora: formatBrazilTime(new Date()),
      motivo,
    }),
  );

  return NextResponse.json({ success: true, data: { baseCode: resultado.baseCode, entregue } });
}
