/**
 * seed-cohorts.ts — Popula turmas nomeadas para dev.
 *
 * Pré-requisito: db:seed + db:seed-dev já executados.
 *
 * O que faz:
 *   - Para UNIFACS, AFYA, UFBA: cria 3 cohorts por faculdade
 *     (CLOSED histórica, ACTIVE atual, PLANNED futura) e atribui
 *     todos os 40 internos + 1º líder ao cohort ACTIVE.
 *   - Para ZARNS: atualiza Turma 2 de PLANNED → ACTIVE
 *     (datas já estão dentro da janela atual).
 *   - EBMSP: já tem Turma 2 ACTIVE com 40 internos — não toca.
 *
 * Uso:
 *   npm run db:seed-cohorts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, isNull } from "drizzle-orm";
import { cohorts, faculties, users, userRoles } from "./schema";

if (process.env.NODE_ENV === "production") {
  console.error("❌ ABORTADO: seed-cohorts.ts não pode rodar em NODE_ENV=production");
  process.exit(1);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost:5432/taximetro";

const DEV_HOSTS = ["localhost", "127.0.0.1", "::1", "db", "taximetro-dev", "172.20.10"];
const isDevUrl = DEV_HOSTS.some((h) => DATABASE_URL.includes(h));
if (!isDevUrl && !process.env.SEED_DEV_FORCE) {
  console.error("❌ ABORTADO: DATABASE_URL não parece ser um banco de desenvolvimento.");
  process.exit(1);
}

async function main() {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client);

  // ── 1. Verificações ────────────────────────────────────────────
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.cpf, "000.000.000-00"));
  if (!admin) {
    console.error("❌ Coordenador não encontrado. Execute npm run db:seed primeiro.");
    await client.end(); process.exit(1);
  }
  const coordId = admin.id;

  const allFac = await db.select().from(faculties);
  const facByAbbr = Object.fromEntries(allFac.map(f => [f.abbreviation, f]));

  // ── 2. ZARNS: Turma 2 PLANNED → ACTIVE ────────────────────────
  console.log("🔄 ZARNS: ativando Turma 2...");
  const [zarns] = await db
    .select({ id: cohorts.id, status: cohorts.status })
    .from(cohorts)
    .where(and(
      eq(cohorts.facultyId, facByAbbr["ZARNS"].id),
      eq(cohorts.status, "PLANNED"),
    ))
    .limit(1);
  if (zarns) {
    await db.update(cohorts).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(cohorts.id, zarns.id));
    console.log("   ✓ ZARNS Turma 2 → ACTIVE");
  } else {
    console.log("   — ZARNS já sem cohort PLANNED ou já ACTIVE");
  }

  // ── 3. Cria cohorts para UNIFACS, AFYA, UFBA ──────────────────
  const TARGETS = ["UNIFACS", "AFYA", "UFBA"] as const;

  // Dates relative to today (2026-04-30)
  const CLOSED_START = "2025-07-01";
  const CLOSED_END   = "2026-01-31";
  const ACTIVE_START = "2026-02-01";
  const ACTIVE_END   = "2026-07-31";
  const PLANNED_START = "2026-08-01";
  const PLANNED_END   = "2027-01-31";

  for (const abbr of TARGETS) {
    const fac = facByAbbr[abbr];
    if (!fac) { console.warn(`⚠  Faculdade ${abbr} não encontrada`); continue; }

    console.log(`\n📚 ${abbr}...`);

    // Check if already has cohorts (idempotent)
    const existing = await db
      .select({ id: cohorts.id })
      .from(cohorts)
      .where(eq(cohorts.facultyId, fac.id));
    if (existing.length > 0) {
      console.log(`   — já tem ${existing.length} cohort(s), pulando criação`);
    } else {
      // CLOSED (rotation 1)
      await db.insert(cohorts).values({
        facultyId: fac.id,
        rotationNumber: 1,
        name: "Turma 1/2025",
        label: `Turma 1 (${abbr})`,
        startDate: CLOSED_START,
        endDate: CLOSED_END,
        status: "CLOSED",
        closedAt: new Date(CLOSED_END + "T23:59:59"),
        closedBy: coordId,
        notes: "Turma encerrada — seed de desenvolvimento.",
        createdBy: coordId,
      }).onConflictDoNothing();
      console.log("   ✓ Turma 1/2025 (CLOSED) criada");

      // ACTIVE (rotation 2)
      const [activeCohort] = await db.insert(cohorts).values({
        facultyId: fac.id,
        rotationNumber: 2,
        name: "Turma 2/2026",
        label: `Turma 2 (${abbr})`,
        startDate: ACTIVE_START,
        endDate: ACTIVE_END,
        status: "ACTIVE",
        notes: "Turma em andamento — seed de desenvolvimento.",
        createdBy: coordId,
      }).onConflictDoNothing().returning({ id: cohorts.id });
      console.log("   ✓ Turma 2/2026 (ACTIVE) criada");

      // PLANNED (rotation 3)
      await db.insert(cohorts).values({
        facultyId: fac.id,
        rotationNumber: 3,
        name: "Turma 3/2026",
        label: `Turma 3 (${abbr})`,
        startDate: PLANNED_START,
        endDate: PLANNED_END,
        status: "PLANNED",
        createdBy: coordId,
      }).onConflictDoNothing();
      console.log("   ✓ Turma 3/2026 (PLANNED) criada");

      // Assign all interns + first leader to ACTIVE cohort
      if (activeCohort) {
        // Assign INTERN roles
        const internResult = await db
          .update(userRoles)
          .set({ cohortId: activeCohort.id })
          .where(and(
            eq(userRoles.facultyId, fac.id),
            eq(userRoles.role, "INTERN"),
            isNull(userRoles.cohortId),
          ));
        console.log(`   ✓ internos atribuídos à turma ativa`);

        // Assign first leader role
        const [firstLeader] = await db
          .select({ id: userRoles.id })
          .from(userRoles)
          .where(and(
            eq(userRoles.facultyId, fac.id),
            eq(userRoles.role, "LEADER"),
            isNull(userRoles.cohortId),
          ))
          .limit(1);
        if (firstLeader) {
          await db.update(userRoles).set({ cohortId: activeCohort.id }).where(eq(userRoles.id, firstLeader.id));
          console.log(`   ✓ líder principal atribuído à turma ativa`);
        }
      }
    }
  }

  // ── 4. Resumo ──────────────────────────────────────────────────
  const summary = await db
    .select({
      abbr: faculties.abbreviation,
      name: cohorts.name,
      status: cohorts.status,
    })
    .from(cohorts)
    .innerJoin(faculties, eq(faculties.id, cohorts.facultyId))
    .orderBy(faculties.abbreviation, cohorts.rotationNumber);

  const internCounts = await db
    .select({ cohortId: userRoles.cohortId, count: userRoles.id })
    .from(userRoles)
    .where(and(eq(userRoles.role, "INTERN")));

  const countByCohort = new Map<string, number>();
  for (const r of internCounts) {
    if (r.cohortId) countByCohort.set(r.cohortId, (countByCohort.get(r.cohortId) ?? 0) + 1);
  }

  const cohortIds = await db.select({ id: cohorts.id, name: cohorts.name }).from(cohorts);
  const nameById = new Map(cohortIds.map(c => [c.id, c.name]));

  console.log(`
${"=".repeat(60)}
  TURMAS APÓS SEED-COHORTS
${"=".repeat(60)}
`);
  let lastFac = "";
  for (const row of summary) {
    if (row.abbr !== lastFac) { console.log(`  ${row.abbr}`); lastFac = row.abbr; }
    const cohortRow = cohortIds.find(c => c.name === row.name);
    const n = cohortRow ? (countByCohort.get(cohortRow.id) ?? 0) : 0;
    console.log(`    ${String(row.name ?? "—").padEnd(20)} ${String(row.status).padEnd(8)} ${n} internos`);
  }

  console.log(`
  Credencial de teste (intern com turma):
    login: qualquer interno de UNIFACS/AFYA/UFBA → demo123
    cohortName aparece no token após re-login
`);

  await client.end();
}

main().catch((err) => {
  console.error("seed-cohorts falhou:", err);
  process.exit(1);
});
