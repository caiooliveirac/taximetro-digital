/**
 * A grade de remanejamento do interno, lida do banco: o plantão em andamento,
 * o aviso de pé e as bases com vaga. É o que a rota
 * `/api/intern/remanejamento` usa para mostrar e para validar, e o que a Dai lê
 * para orientar (luna-dados.ts → `remanejamento`). As regras puras ficam em
 * `remanejamento-interno.ts`; o porquê de cada uma está no topo da rota.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, bases, faculties, userRoles, users } from "@/db/schema";
import { enviar } from "@/features/dai-avisos/remetente";
import { getBrazilNowParts, isCurrentOperationalAssignment } from "@/lib/utils";
import { STATUS_NA_BASE } from "@/lib/aviso-tom";
import {
  ABERTURA_MIN,
  REIVINDICACAO_MIN,
  celulasDaBase,
  horaDoTurno,
  mesmoEndereco,
  minutosDesdeInicioDoTurno,
  participaDoRemanejamento,
  vagasLivresDoInterno,
  type BaseComVaga,
} from "@/lib/remanejamento-interno";
import { avisoDaBase, avisoDoPlantao } from "@/lib/plantao-ao-vivo";
import { basesDoTurno, estadoDasBasesNoTurno } from "@/features/scheduling/application/grade-do-turno";

export type Plantao = {
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
  facultyId: string | null;
};

export type Falha = { status: number; error: string };

export const SEM_AVISO = "Avise a coordenação primeiro (sem médico, sem enfermeiro ou problema na viatura).";

export async function plantaoEmAndamento(internId: string, assignmentId: string): Promise<Plantao | Falha> {
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
      facultyId: assignments.facultyId,
    })
    .from(assignments)
    .innerJoin(bases, eq(bases.id, assignments.baseId))
    .innerJoin(users, eq(users.id, assignments.internId))
    .leftJoin(faculties, eq(faculties.id, assignments.facultyId))
    .where(and(eq(assignments.id, assignmentId), eq(assignments.internId, internId)))
    .limit(1);

  if (!plantao) return { status: 404, error: "Plantão não encontrado" };
  if (!STATUS_NA_BASE.has(plantao.status) || !isCurrentOperationalAssignment(plantao.date, plantao.period)) {
    return { status: 409, error: "O remanejamento só vale para o plantão em andamento." };
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
export async function ultimoAviso(plantao: Plantao): Promise<string | null> {
  const estado = await estadoDasBasesNoTurno(plantao.date, plantao.period);
  const aviso = avisoDoPlantao(estado, plantao.id);
  return aviso ? (aviso.codigo ?? "") : null;
}

/**
 * A grade de hoje, base por base, do ângulo deste interno: qual é a dele,
 * qual é a irmã, e o que ele pode ocupar. A matéria-prima (capacidade, quem
 * está lá, estado da base) é a mesma do Plantão ao vivo da coordenação.
 */
export async function gradeDoTurno(plantao: Plantao, reivindicando: boolean) {
  const { bases } = await basesDoTurno(plantao.date, plantao.period);
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
      celulas: celulasDaBase(base.capacity, base.ocupantes, {
        bloqueada: aviso !== null || parada !== null || base.desativada !== null,
        reivindicarSemCheckin: reivindicando,
        extra,
      }),
    };
  });
  return { bases: grade };
}

export type Tolerancia = { abreAs: string; reivindicaAs: string; aberta: boolean; reivindicando: boolean };

export function toleranciaAgora(period: "DAY" | "NIGHT"): Tolerancia {
  const minutos = minutosDesdeInicioDoTurno(period, getBrazilNowParts());
  return {
    abreAs: horaDoTurno(period, ABERTURA_MIN),
    reivindicaAs: horaDoTurno(period, REIVINDICACAO_MIN),
    aberta: minutos >= ABERTURA_MIN,
    reivindicando: minutos >= REIVINDICACAO_MIN,
  };
}

/** O que o interno vê (GET da rota e a Dai): vagas livres, sem quem está em cada base. */
export async function vagasAgora(plantao: Plantao): Promise<Tolerancia & { bases: BaseComVaga[] }> {
  const tolerancia = toleranciaAgora(plantao.period);
  if (!tolerancia.aberta) return { ...tolerancia, bases: [] };
  const { bases } = await gradeDoTurno(plantao, tolerancia.reivindicando);
  return { ...tolerancia, bases: vagasLivresDoInterno(bases) };
}

/**
 * O líder da faculdade do interno também fica sabendo (decisão do Caio,
 * 18/11/2026), pela conversa com a Dai, como na liberação. Nunca levanta: o
 * remanejamento já aconteceu.
 */
export async function avisarLideres(plantao: Pick<Plantao, "id" | "facultyId">, internId: string, texto: string): Promise<void> {
  if (!plantao.facultyId) return;
  const lideres = await db.selectDistinct({ id: users.id }).from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, "LEADER"), eq(userRoles.facultyId, plantao.facultyId), eq(userRoles.isActive, true), eq(userRoles.isArchived, false), eq(users.isActive, true)))
    .catch(() => []);
  await enviar(lideres.filter((l) => l.id !== internId).map((l) => ({
    para: l.id,
    texto,
    action: "DAI_AVISO_REMANEJAMENTO",
    entityId: l.id,
    payload: { assignmentId: plantao.id },
  })), false).catch(() => {});
}
