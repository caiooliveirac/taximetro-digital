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
 * Base com aviso de problema neste turno, parada pela coordenação no Plantão
 * ao vivo, ou desativada pelo chefe de plantão no `plantoes`, não oferece
 * célula livre: o aviso do interno já fecha a base dele para os outros. Aviso
 * cancelado pela coordenação ("falso alarme") deixa de valer também para o
 * interno que o deu: a grade dele fecha até ele avisar de novo.
 *
 * Tolerâncias, contadas do início real do turno (07:00 / 19:00): a grade só
 * abre aos 10 min, para quem ainda vai chegar fazer check-in e travar a própria
 * vaga; aos 15 min, escalado sem check-in continua visível mas a vaga dele
 * pode ser ocupada por quem procura, e a vaga além da grade (base com uma
 * vaga só por estratégia, mas que cabe dois) abre para todos.
 *
 * A vaga além da grade tem dono preferencial: o interno da base irmã (mesmo
 * endereço, outra viatura). Até os 15 min ela é reserva dele; depois, continua
 * reserva se ele avisou problema neste turno — senão fica livre para quem vier.
 *
 * A vaga é ocupada dentro de um advisory lock por (base, data, turno): dois
 * internos correndo para a mesma vaga entram um de cada vez, e o segundo já
 * não a encontra. O remanejamento em si é o mesmo caso de uso do admin/líder,
 * que grava a nota [REMANEJADO] e o audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, bases, faculties, users } from "@/db/schema";
import { getEffectiveUser, type EffectiveUser } from "@/lib/impersonate";
import { formatBrazilTime, getBrazilNowParts, isCurrentOperationalAssignment } from "@/lib/utils";
import { avisarSecretario, STATUS_NA_BASE } from "@/lib/aviso-tom";
import {
  ABERTURA_MIN,
  REIVINDICACAO_MIN,
  celulaOcupavel,
  celulasDaBase,
  horaDoTurno,
  mesmoEndereco,
  minutosDesdeInicioDoTurno,
  motivoDoRemanejamento,
  participaDoRemanejamento,
  textoDoRemanejamento,
} from "@/lib/remanejamento-interno";
import { avisoDaBase, avisoDoPlantao } from "@/lib/plantao-ao-vivo";
import { basesDoTurno, estadoDasBasesNoTurno } from "@/features/scheduling/application/grade-do-turno";
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
  if (!participaDoRemanejamento(plantao.baseCode)) {
    return { status: 409, error: `A ${plantao.baseCode} fica fora do remanejamento.` };
  }
  return plantao;
}

/**
 * O aviso de pé deste plantão, ou null: sem aviso não há remanejamento. Vem
 * do estado do turno, então cancelamento pela coordenação conta.
 */
async function ultimoAviso(plantao: Plantao): Promise<string | null> {
  const estado = await estadoDasBasesNoTurno(plantao.date, plantao.period);
  const aviso = avisoDoPlantao(estado, plantao.id);
  return aviso ? (aviso.codigo ?? "") : null;
}

const SEM_AVISO = "Avise a coordenação primeiro (sem médico, sem enfermeiro ou problema na viatura).";

/**
 * A grade de hoje, base por base, do ângulo deste interno: qual é a dele,
 * qual é a irmã, e o que ele pode ocupar. A matéria-prima (capacidade, quem
 * está lá, estado da base) é a mesma do Plantão ao vivo da coordenação.
 */
async function gradeDoTurno(plantao: Plantao, reivindicando: boolean) {
  const { bases, medicosDisponiveis } = await basesDoTurno(plantao.date, plantao.period);
  const participantes = bases.filter((b) => participaDoRemanejamento(b.code));

  const grade = participantes.map((base) => {
    const aviso = avisoDaBase(base.estado);
    const { parada } = base.estado;

    // A vaga além da grade e quem tem prioridade nela: o interno da irmã.
    const irma = participantes.find((b) => b.id !== base.id && mesmoEndereco(b, base)) ?? null;
    const souDaIrma = irma !== null && irma.id === plantao.baseId;
    const reservada = irma !== null && (!reivindicando || avisoDaBase(irma.estado) !== null);
    const extra = {
      limite: base.limite,
      podeUsar: souDaIrma || (reivindicando && !reservada),
      reservadaPara: reservada ? irma.code : null,
    };
    return {
      id: base.id,
      code: base.code,
      name: base.name,
      atual: base.id === plantao.baseId,
      irma: base.id !== plantao.baseId && mesmoEndereco(base, plantao),
      aviso: aviso ? { tipo: aviso.tipo, hora: aviso.hora } : null,
      parada,
      desativada: base.desativada,
      medicos: base.medicos,
      celulas: celulasDaBase(base.capacity, base.ocupantes, {
        bloqueada: aviso !== null || parada !== null || base.desativada !== null,
        reivindicarSemCheckin: reivindicando,
        extra,
      }),
    };
  });
  return { bases: grade, medicosDisponiveis };
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
  if ((await ultimoAviso(plantao)) === null) {
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

  const { bases, medicosDisponiveis } = await gradeDoTurno(plantao, tolerancia.reivindicando);
  return NextResponse.json({ success: true, data: { ...tolerancia, medicosDisponiveis, bases } });
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
  const tipo = await ultimoAviso(plantao);
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

    const destino = (await gradeDoTurno(plantao, reivindicando)).bases.find((b) => b.id === newBaseId);
    if (!destino) return { status: 404, body: { success: false, error: "Base de destino inválida" } } as const;
    if (destino.desativada) {
      const desde = destino.desativada.desde ? ` desde ${destino.desativada.desde}` : "";
      return { status: 409, body: { success: false, error: `A ${destino.code} está desativada no plantões${desde}.` } } as const;
    }
    if (destino.parada) {
      return { status: 409, body: { success: false, error: `A ${destino.code} foi parada pela coordenação às ${destino.parada.desde}.` } } as const;
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
