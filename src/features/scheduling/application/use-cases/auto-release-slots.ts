/**
 * Liberação automática de vagas — o job.
 *
 * Roda de hora em hora (cron do container) e logo depois que o coordenador
 * salva a configuração. Materializa como oferta (extra_shift_offers) o que a
 * regra de auto-release-policy.ts manda liberar, para que tudo siga pelo mesmo
 * caminho da vaga liberada à mão: aparece como "vaga livre" na grade dos
 * outros líderes, sai do sorteio da faculdade e o líder dela pode desfazer.
 *
 * Desfeita pelo líder (cancelledBy preenchido) não volta. Retirada pelo próprio
 * job (cancelledBy null) é a que deixou de valer: faculdade desligada ou prazo
 * aumentado.
 */

import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/shared/db/client";
import {
  assignments,
  bases,
  cohorts,
  extraShiftOffers,
  faculties,
  slotRules,
  userRoles,
  users,
  vacancyReleaseSettings,
} from "@/shared/db/schema";
import { logAudit } from "@/shared/infra/logger/audit";
import { addDaysToDateStr, hasShiftStarted, localDateStr } from "@/lib/utils";
import { temFeature } from "@/lib/instance";
import {
  capacidadeDaBase,
  dataDeLiberacao,
  LIBERACAO_AUTOMATICA_DESDE,
  planejarVaga,
  PRAZO_PADRAO_DIAS,
  vagasSemDono,
  type FaculdadeNaVaga,
  type Periodo,
} from "@/features/scheduling/domain/policies/auto-release-policy";

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const PERIODOS: Periodo[] = ["DAY", "NIGHT"];
/** Turma longa não puxa o job meses à frente. */
const HORIZONTE_MAXIMO_DIAS = 90;

function diaDaSemana(date: string) {
  return DOW[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

export type ConfigDaFaculdade = {
  facultyId: string;
  enabled: boolean;
  deadlineDays: number;
  enabledSince: string;
  saved: boolean;
};

export async function listarConfiguracoes(): Promise<Map<string, ConfigDaFaculdade>> {
  const rows = await db.select().from(vacancyReleaseSettings);
  const m = new Map<string, ConfigDaFaculdade>();
  for (const r of rows) {
    m.set(r.facultyId, {
      facultyId: r.facultyId,
      enabled: r.enabled,
      deadlineDays: r.deadlineDays,
      enabledSince: String(r.enabledSince).slice(0, 10),
      saved: true,
    });
  }
  return m;
}

export function configPadrao(facultyId: string): ConfigDaFaculdade {
  return { facultyId, enabled: true, deadlineDays: PRAZO_PADRAO_DIAS, enabledSince: LIBERACAO_AUTOMATICA_DESDE, saved: false };
}

/** Turmas que ainda não fecharam, da mais antiga para a mais nova. */
async function turmasAbertas(today: string) {
  return db
    .select({
      id: cohorts.id,
      facultyId: cohorts.facultyId,
      name: cohorts.name,
      label: cohorts.label,
      rotationNumber: cohorts.rotationNumber,
      startDate: cohorts.startDate,
      endDate: cohorts.endDate,
      status: cohorts.status,
    })
    .from(cohorts)
    .where(and(ne(cohorts.status, "CLOSED"), gte(cohorts.endDate, today)))
    .orderBy(asc(cohorts.startDate));
}

/** Quem assina a oferta criada pelo sistema: publishedBy é obrigatório. */
async function autorDoSistema() {
  const [row] = await db
    .select({ id: users.id })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(userRoles.role, "COORDINATOR"), eq(userRoles.isActive, true), eq(users.isActive, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export type ResultadoLiberacao = {
  skipped?: string;
  created: number;
  semDono: number;
  withdrawn: number;
  byFaculty: Record<string, number>;
  /** Só no dryRun: as ofertas que seriam criadas. */
  plano?: (typeof extraShiftOffers.$inferInsert)[];
};

export async function executeAutoReleaseSlots(params: { now?: Date; dryRun?: boolean } = {}): Promise<ResultadoLiberacao> {
  const vazio = { created: 0, semDono: 0, withdrawn: 0, byFaculty: {} };
  if (!temFeature("liberacaoAutomatica")) return { skipped: "feature desligada nesta instância", ...vazio };

  const now = params.now ?? new Date();
  const today = localDateStr(now);
  const publishedBy = await autorDoSistema();
  if (!publishedBy) return { skipped: "nenhum coordenador ativo para assinar as ofertas", ...vazio };

  const [configs, turmas, facs] = await Promise.all([
    listarConfiguracoes(),
    turmasAbertas(today),
    db.select({ id: faculties.id, abbr: faculties.abbreviation }).from(faculties),
  ]);
  const abbrDe = new Map(facs.map((f) => [f.id, f.abbr]));
  const configDe = (facultyId: string) => configs.get(facultyId) ?? configPadrao(facultyId);

  // Tudo é dentro do rodízio: até o fim da última turma aberta.
  const fimTurmas = turmas.reduce((max, t) => (String(t.endDate) > max ? String(t.endDate) : max), today);
  const limite = addDaysToDateStr(today, HORIZONTE_MAXIMO_DIAS);
  const to = fimTurmas > limite ? limite : fimTurmas;

  /** Vaga sem dono só existe em dia que alguma turma aberta cobre. */
  function emRodizio(date: string) {
    return turmas.some((t) => String(t.startDate) <= date && String(t.endDate) >= date);
  }

  /** A data está numa turma da faculdade cujo prazo já venceu, com o mecanismo ligado. */
  function elegivel(facultyId: string, date: string) {
    const cfg = configDe(facultyId);
    if (!cfg.enabled) return false;
    const turma = turmas.filter((t) => t.facultyId === facultyId && String(t.startDate) <= date && String(t.endDate) >= date).at(-1);
    if (!turma) return false;
    return today >= dataDeLiberacao({ cohortStart: String(turma.startDate), enabledSince: cfg.enabledSince, deadlineDays: cfg.deadlineDays });
  }

  return db.transaction(async (tx) => {
    // Duas execuções ao mesmo tempo (cron + botão) criariam a mesma vaga duas vezes.
    if (!params.dryRun) await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auto-release-slots'))`);

    const [basesUsa, regras, plantoes, ofertas] = await Promise.all([
      tx.select({ id: bases.id, code: bases.code })
        .from(bases)
        .where(and(eq(bases.type, "USA"), eq(bases.isActive, true))),
      tx.select({
        baseId: slotRules.baseId,
        dayOfWeek: slotRules.dayOfWeek,
        period: slotRules.period,
        facultyId: slotRules.facultyId,
        capacity: slotRules.capacity,
        isBlocked: slotRules.isBlocked,
      })
        .from(slotRules)
        .innerJoin(bases, eq(bases.id, slotRules.baseId))
        .where(and(eq(slotRules.isActive, true), eq(slotRules.isExtraShift, false), eq(bases.type, "USA"))),
      tx.select({
        id: assignments.id,
        baseId: assignments.baseId,
        date: assignments.date,
        period: assignments.period,
        facultyId: assignments.facultyId,
      })
        .from(assignments)
        .innerJoin(bases, eq(bases.id, assignments.baseId))
        .where(and(
          eq(bases.type, "USA"),
          gte(assignments.date, today),
          lte(assignments.date, to),
          ne(assignments.status, "CANCELLED"),
        )),
      tx.select({
        id: extraShiftOffers.id,
        baseId: extraShiftOffers.baseId,
        date: extraShiftOffers.date,
        period: extraShiftOffers.period,
        releasedFacultyId: extraShiftOffers.releasedFacultyId,
        autoRelease: extraShiftOffers.autoRelease,
        claimedBy: extraShiftOffers.claimedBy,
        assignmentId: extraShiftOffers.assignmentId,
        cancelledAt: extraShiftOffers.cancelledAt,
        cancelledBy: extraShiftOffers.cancelledBy,
      })
        .from(extraShiftOffers)
        .where(and(gte(extraShiftOffers.date, today), lte(extraShiftOffers.date, to))),
    ]);

    const chave = (baseId: string, date: string, period: string) => `${baseId}|${String(date).slice(0, 10)}|${period}`;
    const plantoesPor = new Map<string, typeof plantoes>();
    for (const p of plantoes) {
      const k = chave(p.baseId, p.date, p.period);
      plantoesPor.set(k, [...(plantoesPor.get(k) ?? []), p]);
    }
    const ofertasPor = new Map<string, typeof ofertas>();
    for (const o of ofertas) {
      const k = chave(o.baseId, o.date, o.period);
      ofertasPor.set(k, [...(ofertasPor.get(k) ?? []), o]);
    }
    // Plantão que veio de vaga livre não é a faculdade usando a grade dela.
    const deVagaLivre = new Set(
      ofertas.filter((o) => o.assignmentId && (o.releasedFacultyId || o.autoRelease === "SEM_DONO")).map((o) => o.assignmentId!),
    );

    const criar: (typeof extraShiftOffers.$inferInsert)[] = [];
    const retirar: string[] = [];
    const byFaculty: Record<string, number> = {};
    let semDonoTotal = 0;

    for (let date = today; date <= to; date = addDaysToDateStr(date, 1)) {
      const dow = diaDaSemana(date);
      for (const base of basesUsa) {
        for (const period of PERIODOS) {
          const k = chave(base.id, date, period);
          const ofertasAqui = ofertasPor.get(k) ?? [];

          // Automática viva que deixou de valer volta para a faculdade.
          for (const o of ofertasAqui) {
            if (o.autoRelease === "PRAZO" && !o.cancelledAt && !o.claimedBy && o.releasedFacultyId && !elegivel(o.releasedFacultyId, date)) {
              retirar.push(o.id);
              o.cancelledAt = now;
            }
          }

          if (hasShiftStarted(date, period, null, now)) continue;
          const regrasAqui = regras.filter((r) => r.baseId === base.id && r.dayOfWeek === dow && r.period === period);
          const cap = capacidadeDaBase(base.code, period);
          if (regrasAqui.length === 0 && cap === null) continue;

          // Sem dono além do teto (teto baixou, ou faculdade ganhou a vaga na
          // grade) sai do ar, se ninguém pegou.
          const semDonoVivas = ofertasAqui.filter((o) => o.autoRelease === "SEM_DONO" && !o.cancelledAt);
          let sobra = semDonoVivas.length - vagasSemDono(cap, regrasAqui.reduce((n, r) => n + r.capacity, 0));
          for (const o of semDonoVivas) {
            if (sobra <= 0) break;
            if (o.claimedBy) continue;
            retirar.push(o.id);
            o.cancelledAt = now;
            sobra--;
          }

          const plantoesAqui = plantoesPor.get(k) ?? [];
          const vivas = ofertasAqui.filter((o) => !o.cancelledAt);
          const faculdadesNaVaga: FaculdadeNaVaga[] = regrasAqui.map((r) => ({
            facultyId: r.facultyId,
            capacity: r.capacity,
            blocked: r.isBlocked,
            eligible: elegivel(r.facultyId, date),
            assigned: plantoesAqui.filter((p) => p.facultyId === r.facultyId && !deVagaLivre.has(p.id)).length,
            alreadyReleased: ofertasAqui.filter((o) =>
              o.releasedFacultyId === r.facultyId
              && (!o.cancelledAt || (o.autoRelease === "PRAZO" && o.cancelledBy))).length,
          }));

          const plano = planejarVaga({
            cap,
            faculdades: faculdadesNaVaga,
            totalAssigned: plantoesAqui.length,
            openOffers: vivas.filter((o) => !o.claimedBy).length,
            semDonoExistentes: ofertasAqui.filter((o) => o.autoRelease === "SEM_DONO" && (!o.cancelledAt || o.cancelledBy)).length,
          });

          for (const [facultyId, n] of plano.porFaculdade) {
            const abbr = abbrDe.get(facultyId) ?? "faculdade";
            byFaculty[abbr] = (byFaculty[abbr] ?? 0) + n;
            for (let i = 0; i < n; i++) {
              criar.push({
                baseId: base.id, date, period, publishedBy,
                releasedFacultyId: facultyId,
                autoRelease: "PRAZO",
                notes: `Liberada automaticamente: a ${abbr} não usou a vaga no prazo da turma`,
              });
            }
          }
          if (emRodizio(date)) {
            semDonoTotal += plano.semDono;
            for (let i = 0; i < plano.semDono; i++) {
              criar.push({
                baseId: base.id, date, period, publishedBy,
                autoRelease: "SEM_DONO",
                notes: "Vaga sem dono na grade: livre para qualquer líder",
              });
            }
          }
        }
      }
    }

    if (params.dryRun) {
      return { created: criar.length, semDono: semDonoTotal, withdrawn: retirar.length, byFaculty, plano: criar };
    }
    if (retirar.length > 0) {
      await tx.update(extraShiftOffers)
        .set({ cancelledAt: now })
        .where(and(inArray(extraShiftOffers.id, retirar), isNull(extraShiftOffers.claimedBy), isNull(extraShiftOffers.cancelledAt)));
    }
    for (let i = 0; i < criar.length; i += 500) {
      await tx.insert(extraShiftOffers).values(criar.slice(i, i + 500));
    }

    const resultado = { created: criar.length, semDono: semDonoTotal, withdrawn: retirar.length, byFaculty };
    if (criar.length > 0 || retirar.length > 0) {
      await logAudit({
        action: "SLOTS_AUTO_RELEASED",
        entity: "extra_shift_offers",
        payload: { ...resultado, from: today, to },
      });
    }
    return resultado;
  });
}

/* ═══════════ Tela de configuração ═══════════ */

export async function getAutoReleaseOverview() {
  const today = localDateStr();
  const [configs, turmas, facs, contagem] = await Promise.all([
    listarConfiguracoes(),
    turmasAbertas(today),
    db.select({ id: faculties.id, abbr: faculties.abbreviation, name: faculties.name })
      .from(faculties)
      .where(eq(faculties.isVirtual, false))
      .orderBy(asc(faculties.abbreviation)),
    db.select({
      facultyId: extraShiftOffers.releasedFacultyId,
      autoRelease: extraShiftOffers.autoRelease,
      abertas: sql<number>`count(*) filter (where ${extraShiftOffers.claimedBy} is null)::int`,
      usadas: sql<number>`count(${extraShiftOffers.claimedBy})::int`,
    })
      .from(extraShiftOffers)
      .where(and(
        gte(extraShiftOffers.date, today),
        isNull(extraShiftOffers.cancelledAt),
        sql`${extraShiftOffers.autoRelease} is not null`,
      ))
      .groupBy(extraShiftOffers.releasedFacultyId, extraShiftOffers.autoRelease),
  ]);

  const faculdades = facs.map((f) => {
    const cfg = configs.get(f.id) ?? configPadrao(f.id);
    const minhas = contagem.find((c) => c.facultyId === f.id && c.autoRelease === "PRAZO");
    return {
      ...cfg,
      abbreviation: f.abbr,
      name: f.name,
      turmas: turmas
        .filter((t) => t.facultyId === f.id)
        .map((t) => ({
          id: t.id,
          nome: t.name || t.label || `Turma ${t.rotationNumber}`,
          startDate: String(t.startDate).slice(0, 10),
          endDate: String(t.endDate).slice(0, 10),
          status: t.status,
          liberaEm: dataDeLiberacao({ cohortStart: String(t.startDate), enabledSince: cfg.enabledSince, deadlineDays: cfg.deadlineDays }),
        })),
      liberadasAbertas: minhas?.abertas ?? 0,
      liberadasUsadas: minhas?.usadas ?? 0,
    };
  });

  const semDono = contagem.filter((c) => c.autoRelease === "SEM_DONO");
  const fimRodizio = turmas.reduce<string | null>((max, t) => {
    const fim = String(t.endDate).slice(0, 10);
    return !max || fim > max ? fim : max;
  }, null);
  return {
    today,
    faculdades,
    semDono: {
      ate: fimRodizio,
      abertas: semDono.reduce((n, c) => n + c.abertas, 0),
      usadas: semDono.reduce((n, c) => n + c.usadas, 0),
    },
  };
}

export async function saveAutoReleaseSettings(params: {
  actorId: string;
  facultyId: string;
  enabled: boolean;
  deadlineDays: number;
}) {
  const today = localDateStr();
  const [atual] = await db.select().from(vacancyReleaseSettings).where(eq(vacancyReleaseSettings.facultyId, params.facultyId)).limit(1);
  const antes = atual
    ? { enabled: atual.enabled, deadlineDays: atual.deadlineDays, enabledSince: String(atual.enabledSince).slice(0, 10) }
    : { enabled: true, deadlineDays: PRAZO_PADRAO_DIAS, enabledSince: LIBERACAO_AUTOMATICA_DESDE };
  // Religar dá à turma o prazo inteiro de novo, contado de hoje: ninguém perde
  // vaga por uma regra que estava desligada.
  const enabledSince = params.enabled && !antes.enabled ? today : antes.enabledSince;

  const valores = {
    enabled: params.enabled,
    deadlineDays: params.deadlineDays,
    enabledSince,
    updatedBy: params.actorId,
    updatedAt: new Date(),
  };
  await db.insert(vacancyReleaseSettings)
    .values({ facultyId: params.facultyId, ...valores })
    .onConflictDoUpdate({ target: vacancyReleaseSettings.facultyId, set: valores });

  const [fac] = await db.select({ abbr: faculties.abbreviation }).from(faculties).where(eq(faculties.id, params.facultyId)).limit(1);
  await logAudit({
    userId: params.actorId,
    action: "AUTO_RELEASE_SETTINGS",
    entity: "vacancy_release_settings",
    entityId: params.facultyId,
    payload: { facultyAbbr: fac?.abbr ?? null, antes, depois: { enabled: params.enabled, deadlineDays: params.deadlineDays, enabledSince } },
  });
}

/* ═══════════ KPI do cockpit ═══════════ */

/**
 * Quem usou vaga livre (liberada à mão, pelo prazo ou sem dono) nos últimos
 * `dias` — para a coordenação ver se algum líder está concentrando vagas.
 * Conta pelo dia da escolha, não pelo dia do plantão.
 */
export async function listFreeSlotUsage(dias = 30) {
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  const liberou = db.$with("liberou").as(db.select({ id: faculties.id, abbr: faculties.abbreviation }).from(faculties));
  const rows = await db
    .with(liberou)
    .select({
      leaderId: assignments.createdBy,
      leaderName: users.name,
      facultyAbbr: faculties.abbreviation,
      baseCode: bases.code,
      date: extraShiftOffers.date,
      period: extraShiftOffers.period,
      autoRelease: extraShiftOffers.autoRelease,
      releasedByAbbr: liberou.abbr,
      claimedAt: extraShiftOffers.claimedAt,
    })
    .from(extraShiftOffers)
    .innerJoin(assignments, eq(assignments.id, extraShiftOffers.assignmentId))
    .innerJoin(users, eq(users.id, assignments.createdBy))
    .innerJoin(faculties, eq(faculties.id, assignments.facultyId))
    .innerJoin(bases, eq(bases.id, extraShiftOffers.baseId))
    .leftJoin(liberou, eq(liberou.id, extraShiftOffers.releasedFacultyId))
    .where(and(
      sql`(${extraShiftOffers.releasedFacultyId} is not null or ${extraShiftOffers.autoRelease} = 'SEM_DONO')`,
      isNull(extraShiftOffers.reservedBy),
      gte(extraShiftOffers.claimedAt, desde),
      ne(assignments.status, "CANCELLED"),
    ))
    .orderBy(sql`${extraShiftOffers.claimedAt} desc`);

  return rows.map((r) => ({
    ...r,
    date: String(r.date).slice(0, 10),
    origem: r.autoRelease === "SEM_DONO" ? "sem dono" : r.autoRelease === "PRAZO" ? `${r.releasedByAbbr ?? "?"} (prazo)` : (r.releasedByAbbr ?? "?"),
    claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
  }));
}
