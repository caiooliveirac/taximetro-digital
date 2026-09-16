/**
 * Plantão ao vivo — o turno em andamento para a coordenação intervir do celular.
 *
 * GET  — a grade do turno operacional de agora: cada USA com suas células
 *        (quem está lá, nome e faculdade, com ou sem check-in; as livres; a
 *        vaga além da grade), o aviso de pé, a parada pela coordenação, a
 *        desativação no `plantoes`, o médico presente, e a lista de quem já
 *        foi liberado para repor em outro dia.
 * POST {acao, ...} — uma intervenção por chamada:
 *   mover          arrasta um interno para outra base (mesmo caso de uso do
 *                  remanejamento, com nota [REMANEJADO] e audit) e avisa o
 *                  interno no Telegram;
 *   cancelarAviso  "falso alarme": derruba o aviso da base, que volta a
 *                  oferecer vaga — e o interno que avisou perde a grade;
 *   pararBase      a base parou de verdade: fecha para quem procura vaga e
 *                  guarda o motivo; reabrirBase desfaz;
 *   repor          não há mais vaga em lugar nenhum: o plantão de hoje vira
 *                  CANCELLED com a marca [REPOR] — não é falta, não conta
 *                  para a meta, o interno repõe em outro dia; desfazerRepor
 *                  devolve o status que tinha.
 *
 * Tudo é evento no audit_log (ver plantao-ao-vivo.ts); a grade do interno lê
 * os mesmos eventos, então o que a coordenação faz aqui aparece lá na hora.
 * Cada intervenção é contada no privado do bot aos outros coordenadores
 * vinculados — quem fez já sabe.
 * Só o turno operacional em andamento: intervenção em outro dia é a tela de
 * Remanejamento ou a Escala.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { assignments, auditLog, bases, faculties, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getEffectiveUser, type EffectiveUser } from "@/lib/impersonate";
import { formatBrazilTime, getBrazilNowParts, isCurrentOperationalAssignment, operationalDateStr, operationalPeriod } from "@/lib/utils";
import { STATUS_NA_BASE } from "@/lib/aviso-tom";
import { ABERTURA_MIN, REIVINDICACAO_MIN, celulasDaBase, horaDoTurno, minutosDesdeInicioDoTurno } from "@/lib/remanejamento-interno";
import {
  ACAO,
  avisoDaBase,
  ehReposicao,
  horaDaReposicao,
  MARCA_REPOR,
  notaDeReposicao,
  semNotaDeReposicao,
  textoDaIntervencao,
  textoParaInternoRemanejado,
  textoParaInternoRepor,
  textoParaInternoReposicaoDesfeita,
  type Intervencao,
} from "@/lib/plantao-ao-vivo";
import { avisarInternoNoTelegram } from "@/lib/telegram-interno";
import { avisarCoordenacaoNoTelegram } from "@/lib/telegram-coordenacao";
import { basesDoTurno, type BaseDoTurno, type Periodo } from "@/features/scheduling/application/grade-do-turno";
import { executeReassignAssignmentBase } from "@/features/scheduling/application/use-cases/reassign-assignment-base";
import { updateAssignmentStatus } from "@/features/scheduling/infra/repositories/assignment-repository";

function turnoDeAgora(): { date: string; period: Periodo } {
  return { date: operationalDateStr(), period: operationalPeriod() };
}

/** A base do ângulo da coordenação: tudo à mostra, célula com nome, e se cabe mais um. */
function baseParaCoordenacao(base: BaseDoTurno) {
  const aviso = avisoDaBase(base.estado);
  const { parada } = base.estado;
  const bloqueada = aviso !== null || parada !== null || base.desativada !== null;
  const celulas = celulasDaBase(base.capacity, base.ocupantes, {
    bloqueada,
    extra: { limite: base.limite, podeUsar: true, reservadaPara: null },
  }).map((c, i) => (c.tipo === "ocupada" ? { ...c, ocupante: base.ocupantes[i] } : c));
  return {
    id: base.id,
    code: base.code,
    name: base.name,
    capacity: base.capacity,
    limite: base.limite,
    aviso,
    avisos: base.estado.avisos,
    parada,
    desativada: base.desativada,
    medicos: base.medicos,
    // Destino possível para arrastar alguém: funcionando, e com lugar físico.
    aceitaMais: !bloqueada && (base.limite === 0 || base.ocupantes.length < base.limite),
    celulas,
  };
}

/** Quem a coordenação já liberou neste turno para repor em outro dia. */
async function liberadosDoTurno(date: string, period: Periodo) {
  const linhas = await db
    .select({
      assignmentId: assignments.id,
      internId: assignments.internId,
      interno: users.name,
      faculdade: faculties.abbreviation,
      baseCode: bases.code,
      notes: assignments.notes,
    })
    .from(assignments)
    .innerJoin(users, eq(users.id, assignments.internId))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .where(
      and(
        eq(assignments.date, date),
        eq(assignments.period, period),
        eq(assignments.status, "CANCELLED"),
        sql`${assignments.notes} LIKE ${`%${MARCA_REPOR}%`}`,
      ),
    )
    .orderBy(assignments.updatedAt);
  return linhas.map(({ notes, ...l }) => ({ ...l, hora: horaDaReposicao(notes) }));
}

export async function GET(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const { date, period } = turnoDeAgora();
  const [{ bases: lista, medicosDisponiveis }, liberados] = await Promise.all([basesDoTurno(date, period), liberadosDoTurno(date, period)]);
  const minutos = minutosDesdeInicioDoTurno(period, getBrazilNowParts());

  return NextResponse.json({
    success: true,
    data: {
      date,
      period,
      agora: formatBrazilTime(new Date()),
      tolerancia: {
        abreAs: horaDoTurno(period, ABERTURA_MIN),
        reivindicaAs: horaDoTurno(period, REIVINDICACAO_MIN),
        aberta: minutos >= ABERTURA_MIN,
        reivindicando: minutos >= REIVINDICACAO_MIN,
      },
      medicosDisponiveis,
      bases: lista.map(baseParaCoordenacao),
      liberados,
    },
  });
}

const uuid = z.string().uuid();
const motivo = z.string().trim().max(300).optional();

const acaoSchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("mover"), assignmentId: uuid, newBaseId: uuid, motivo }),
  z.object({ acao: z.literal("cancelarAviso"), baseId: uuid }),
  z.object({ acao: z.literal("pararBase"), baseId: uuid, motivo }),
  z.object({ acao: z.literal("reabrirBase"), baseId: uuid }),
  z.object({ acao: z.literal("repor"), assignmentId: uuid, motivo }),
  z.object({ acao: z.literal("desfazerRepor"), assignmentId: uuid }),
]);

type Falha = { status: number; error: string };
const falha = (status: number, error: string): Falha => ({ status, error });

async function plantaoDoTurno(assignmentId: string) {
  const [plantao] = await db
    .select({
      id: assignments.id,
      internId: assignments.internId,
      baseId: assignments.baseId,
      baseCode: bases.code,
      date: assignments.date,
      period: assignments.period,
      status: assignments.status,
      isExtraShift: assignments.isExtraShift,
      notes: assignments.notes,
      interno: users.name,
      faculdade: sql<string>`COALESCE(${faculties.abbreviation}, '')`,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .leftJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!plantao) return falha(404, "Plantão não encontrado");
  if (!isCurrentOperationalAssignment(plantao.date, plantao.period)) {
    return falha(409, "O Plantão ao vivo só mexe no turno em andamento. Para outro dia, use o Remanejamento.");
  }
  if (plantao.isExtraShift) return falha(409, "Plantão extra fica fora do Plantão ao vivo.");
  return plantao;
}

async function baseDoTurno(baseId: string, turno: { date: string; period: Periodo }) {
  const { bases: lista } = await basesDoTurno(turno.date, turno.period);
  return lista.find((b) => b.id === baseId) ?? null;
}

function actorDe(user: EffectiveUser) {
  return { id: user.id, role: user.role, facultyId: user.facultyId, isImpersonating: user.isImpersonating, realUserId: user.realUserId };
}

/** Conta aos outros coordenadores, no privado do bot. Nunca levanta; devolve quantos receberam. */
async function contarAosOutros(user: EffectiveUser, intervencao: Intervencao): Promise<number> {
  const [autor] = await db.select({ nome: users.name }).from(users).where(eq(users.id, user.realUserId ?? user.id)).limit(1);
  return avisarCoordenacaoNoTelegram(textoDaIntervencao(autor?.nome ?? "Coordenação", intervencao, formatBrazilTime(new Date())), {
    exceto: user.realUserId ?? user.id,
  });
}

async function executar(user: EffectiveUser, pedido: z.infer<typeof acaoSchema>) {
  const turno = turnoDeAgora();
  const carimbo = { date: turno.date, period: turno.period };

  switch (pedido.acao) {
    case "mover": {
      const plantao = await plantaoDoTurno(pedido.assignmentId);
      if ("error" in plantao) return plantao;
      const destino = await baseDoTurno(pedido.newBaseId, turno);
      if (!destino) return falha(404, "Base de destino inválida");
      if (destino.estado.parada) return falha(409, `A ${destino.code} está parada pela coordenação desde ${destino.estado.parada.desde}. Reabra antes.`);
      const avisoDoDestino = avisoDaBase(destino.estado);
      if (avisoDoDestino) return falha(409, `A ${destino.code} tem aviso de ${avisoDoDestino.tipo} às ${avisoDoDestino.hora}. Cancele o aviso se for falso.`);
      if (destino.desativada) return falha(409, `A ${destino.code} está desativada no plantões.`);

      const origem = await baseDoTurno(plantao.baseId, turno);
      const motivoDaOrigem = origem?.estado.parada?.motivo ?? avisoDaBase(origem?.estado)?.tipo ?? null;
      const motivo = pedido.motivo || motivoDaOrigem;
      const resultado = await executeReassignAssignmentBase({
        actor: actorDe(user),
        input: {
          assignmentId: plantao.id,
          newBaseId: destino.id,
          reason: `Plantão ao vivo: ${motivo ?? "remanejado pela coordenação"}`,
          authorized: true,
        },
      });
      if (resultado.status !== 200) return falha(resultado.status, resultado.body.error ?? "Não foi possível remanejar.");

      const [entregue] = await Promise.all([
        avisarInternoNoTelegram(plantao.internId, textoParaInternoRemanejado({ de: plantao.baseCode, para: destino.code, nomeDaBase: destino.name, motivo })),
        contarAosOutros(user, { acao: "mover", interno: plantao.interno, faculdade: plantao.faculdade, de: plantao.baseCode, para: destino.code, motivo }),
      ]);
      return { interno: plantao.interno, de: plantao.baseCode, para: destino.code, entregue };
    }

    case "cancelarAviso": {
      const base = await baseDoTurno(pedido.baseId, turno);
      if (!base) return falha(404, "Base inválida");
      if (base.estado.avisos.length === 0) return falha(409, `A ${base.code} não tem aviso de pé.`);
      await logAudit({
        userId: user.realUserId ?? user.id,
        action: ACAO.avisoCancelado,
        entity: "base",
        entityId: base.id,
        payload: {
          ...carimbo,
          baseId: base.id,
          baseCode: base.code,
          avisos: base.estado.avisos.map((a) => ({ assignmentId: a.assignmentId, interno: a.interno, tipo: a.codigo, hora: a.hora })),
        },
      });
      await contarAosOutros(user, { acao: "cancelarAviso", baseCode: base.code, interno: avisoDaBase(base.estado)?.interno ?? null });
      return { baseCode: base.code };
    }

    case "pararBase": {
      const base = await baseDoTurno(pedido.baseId, turno);
      if (!base) return falha(404, "Base inválida");
      if (base.estado.parada) return falha(409, `A ${base.code} já está parada desde ${base.estado.parada.desde}.`);
      await logAudit({
        userId: user.realUserId ?? user.id,
        action: ACAO.baseParada,
        entity: "base",
        entityId: base.id,
        payload: { ...carimbo, baseId: base.id, baseCode: base.code, motivo: pedido.motivo || null },
      });
      await contarAosOutros(user, { acao: "pararBase", baseCode: base.code, motivo: pedido.motivo || null });
      return { baseCode: base.code };
    }

    case "reabrirBase": {
      const base = await baseDoTurno(pedido.baseId, turno);
      if (!base) return falha(404, "Base inválida");
      if (!base.estado.parada) return falha(409, `A ${base.code} não está parada pela coordenação.`);
      await logAudit({
        userId: user.realUserId ?? user.id,
        action: ACAO.baseReaberta,
        entity: "base",
        entityId: base.id,
        payload: { ...carimbo, baseId: base.id, baseCode: base.code },
      });
      await contarAosOutros(user, { acao: "reabrirBase", baseCode: base.code });
      return { baseCode: base.code };
    }

    case "repor": {
      const plantao = await plantaoDoTurno(pedido.assignmentId);
      if ("error" in plantao) return plantao;
      if (!STATUS_NA_BASE.has(plantao.status)) return falha(409, "Este plantão já foi encerrado; não há o que liberar.");

      const base = await baseDoTurno(plantao.baseId, turno);
      const motivo = pedido.motivo || base?.estado.parada?.motivo || avisoDaBase(base?.estado)?.tipo || null;
      const hora = formatBrazilTime(new Date());
      const nota = notaDeReposicao({ baseCode: plantao.baseCode, hora, motivo });
      await updateAssignmentStatus({
        id: plantao.id,
        status: "CANCELLED",
        notes: plantao.notes ? `${plantao.notes}\n${nota}` : nota,
      });
      await logAudit({
        userId: user.realUserId ?? user.id,
        action: ACAO.liberadoParaRepor,
        entity: "assignment",
        entityId: plantao.id,
        payload: { ...carimbo, baseId: plantao.baseId, baseCode: plantao.baseCode, previousStatus: plantao.status, motivo },
      });
      const [entregue] = await Promise.all([
        avisarInternoNoTelegram(plantao.internId, textoParaInternoRepor({ baseCode: plantao.baseCode, motivo })),
        contarAosOutros(user, { acao: "repor", interno: plantao.interno, faculdade: plantao.faculdade, baseCode: plantao.baseCode, motivo }),
      ]);
      return { interno: plantao.interno, baseCode: plantao.baseCode, entregue };
    }

    case "desfazerRepor": {
      const plantao = await plantaoDoTurno(pedido.assignmentId);
      if ("error" in plantao) return plantao;
      if (plantao.status !== "CANCELLED" || !ehReposicao(plantao.notes)) return falha(409, "Este plantão não está liberado para reposição.");

      const [liberacao] = await db
        .select({ payload: auditLog.payload })
        .from(auditLog)
        .where(and(eq(auditLog.action, ACAO.liberadoParaRepor), eq(auditLog.entityId, plantao.id)))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      const anterior = (liberacao?.payload as { previousStatus?: string } | null)?.previousStatus;
      const status = anterior && STATUS_NA_BASE.has(anterior) ? anterior : "SCHEDULED";

      // null de propósito: sem o resto da nota, a coluna tem que ficar vazia (undefined manteria o [REPOR]).
      await updateAssignmentStatus({ id: plantao.id, status, notes: semNotaDeReposicao(plantao.notes) });
      await logAudit({
        userId: user.realUserId ?? user.id,
        action: ACAO.reposicaoDesfeita,
        entity: "assignment",
        entityId: plantao.id,
        payload: { ...carimbo, baseId: plantao.baseId, baseCode: plantao.baseCode, restoredStatus: status },
      });
      const [entregue] = await Promise.all([
        avisarInternoNoTelegram(plantao.internId, textoParaInternoReposicaoDesfeita({ baseCode: plantao.baseCode })),
        contarAosOutros(user, { acao: "desfazerRepor", interno: plantao.interno, faculdade: plantao.faculdade, baseCode: plantao.baseCode }),
      ]);
      return { interno: plantao.interno, baseCode: plantao.baseCode, status, entregue };
    }
  }
}

export async function POST(req: NextRequest) {
  const user = await getEffectiveUser(req);
  if (!user || user.role !== "COORDINATOR") {
    return NextResponse.json({ success: false, error: "Sem permissão" }, { status: 403 });
  }
  const parsed = acaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Pedido inválido" }, { status: 400 });
  }
  const resultado = await executar(user, parsed.data);
  if ("error" in resultado) return NextResponse.json({ success: false, error: resultado.error }, { status: resultado.status });
  return NextResponse.json({ success: true, data: resultado });
}
