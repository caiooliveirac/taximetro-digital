import { localDateStr } from "@/lib/utils";
import { logAudit } from "@/shared/infra/logger/audit";
import {
  activateCohort,
  countCohortLeaders,
  createCohort,
  listFacultyCohortsWithAbbr,
} from "@/features/cohorts/infra/repositories/cohort-repository";
import { MAX_LEADERS_PER_COHORT, pickOpenCohort, planNextCohort } from "@/features/cohorts/domain/intern-cohort";

export class InternCohortError extends Error {}

function isUniqueViolation(err: unknown) {
  const msg = err instanceof Error ? `${err.message} ${(err as { code?: string }).code ?? ""}` : String(err);
  return msg.includes("23505") || msg.includes("unique") || msg.includes("uq_cohort");
}

/** Cria a próxima turma da faculdade; ACTIVE se começa hoje, senão PLANNED (o cron ativa). */
export async function createNextCohort(params: { facultyId: string; createdBy: string; reason: string }) {
  const data = await listFacultyCohortsWithAbbr(params.facultyId);
  if (!data) throw new InternCohortError("Faculdade não encontrada");
  const last = data.cohorts.reduce<(typeof data.cohorts)[number] | null>(
    (acc, c) => (!acc || c.rotationNumber > acc.rotationNumber ? c : acc), null);
  const today = localDateStr();
  const plan = planNextCohort({ facultyAbbr: data.facultyAbbr, today, last });

  const created = await createCohort({ ...plan, facultyId: params.facultyId, createdBy: params.createdBy });
  if (plan.startDate <= today) await activateCohort(created.id);
  await logAudit({
    userId: params.createdBy,
    action: "AUTO_CREATE_COHORT",
    entity: "cohort",
    entityId: created.id,
    payload: { ...plan, facultyId: params.facultyId, reason: params.reason },
  });
  return created.id;
}

/**
 * Turma onde um interno (ou líder) da faculdade deve entrar. Com `cohortId`, valida que
 * é da faculdade e não está fechada. Sem ela (ou se a pedida fechou), usa a
 * turma aberta da faculdade; sem nenhuma aberta, cria a próxima.
 */
export async function ensureInternCohort(params: {
  facultyId: string;
  cohortId?: string | null;
  createdBy: string;
  reason: string;
  /** true: a turma pedida tem de servir; não cai para a aberta. */
  strict?: boolean;
}): Promise<string> {
  const data = await listFacultyCohortsWithAbbr(params.facultyId);
  if (!data) throw new InternCohortError("Faculdade não encontrada");

  if (params.cohortId) {
    const wanted = data.cohorts.find((c) => c.id === params.cohortId);
    if (wanted && wanted.status !== "CLOSED") return wanted.id;
    if (params.strict) {
      throw new InternCohortError(wanted ? "Turma fechada não aceita novos internos" : "Turma não pertence a esta faculdade");
    }
  }

  const open = pickOpenCohort(data.cohorts, localDateStr());
  if (open) return open.id;

  try {
    return await createNextCohort(params);
  } catch (err) {
    // Dois cadastros ao mesmo tempo: o outro criou a turma primeiro.
    if (!isUniqueViolation(err)) throw err;
    const again = await listFacultyCohortsWithAbbr(params.facultyId);
    const raced = again && pickOpenCohort(again.cohorts, localDateStr());
    if (raced) return raced.id;
    throw err;
  }
}

/** Turma que `ensureInternCohort` daria, sem criar nada (null = ela criaria a próxima). */
export async function peekInternCohort(facultyId: string, cohortId?: string | null): Promise<string | null> {
  const data = await listFacultyCohortsWithAbbr(facultyId);
  if (!data) return null;
  const wanted = cohortId ? data.cohorts.find((c) => c.id === cohortId) : null;
  if (wanted && wanted.status !== "CLOSED") return wanted.id;
  return pickOpenCohort(data.cohorts, localDateStr())?.id ?? null;
}

/** A turma ainda cabe mais um líder? Turma que nem existe ainda cabe. */
export async function cohortHasLeaderRoom(cohortId: string | null, exceptUserId?: string): Promise<boolean> {
  if (!cohortId) return true;
  return (await countCohortLeaders(cohortId, exceptUserId)) < MAX_LEADERS_PER_COHORT;
}
