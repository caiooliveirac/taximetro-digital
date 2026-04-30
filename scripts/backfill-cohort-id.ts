/**
 * Backfill cohort_id em user_roles para INTERNs ativos.
 *
 * Uso:
 *   node --env-file .env.local --import tsx scripts/backfill-cohort-id.ts
 *   node --env-file .env.local --import tsx scripts/backfill-cohort-id.ts --apply
 *
 * Sem --apply: dry-run (mostra o que seria alterado).
 * Com --apply: aplica as alterações.
 */
import postgres from "postgres";

const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definida");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  console.log(`[backfill-cohort-id] modo: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

  // Interns ativos sem cohortId
  const withoutCohort = await sql`
    SELECT ur.id, ur.user_id, ur.faculty_id, u.name, f.abbreviation
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN faculties f ON f.id = ur.faculty_id
    WHERE ur.role = 'INTERN'
      AND ur.is_archived = false
      AND ur.cohort_id IS NULL
    ORDER BY f.abbreviation, u.name
  `;
  console.log(`Interns sem cohort_id: ${withoutCohort.length}`);

  // Para cada intern, tentar achar cohort pelo primeiro assignment
  let assigned = 0;
  let unresolved = 0;
  const unresolvedList: { name: string; faculty: string }[] = [];

  for (const ur of withoutCohort) {
    const [firstAssignment] = await sql`
      SELECT date FROM assignments
      WHERE intern_id = ${ur.user_id} AND faculty_id = ${ur.faculty_id}
      ORDER BY date ASC LIMIT 1
    `;

    if (!firstAssignment) {
      unresolved++;
      unresolvedList.push({ name: ur.name, faculty: ur.abbreviation });
      continue;
    }

    const [cohort] = await sql`
      SELECT id, label FROM cohorts
      WHERE faculty_id = ${ur.faculty_id}
        AND start_date <= ${firstAssignment.date}
        AND end_date >= ${firstAssignment.date}
      LIMIT 1
    `;

    if (!cohort) {
      unresolved++;
      unresolvedList.push({ name: ur.name, faculty: ur.abbreviation });
      continue;
    }

    if (!DRY_RUN) {
      await sql`UPDATE user_roles SET cohort_id = ${cohort.id} WHERE id = ${ur.id}`;
    } else {
      console.log(`  [dry] ${ur.abbreviation} | ${ur.name} → ${cohort.label}`);
    }
    assigned++;
  }

  console.log(`\nResultado:`);
  console.log(`  Atribuíveis: ${assigned}`);
  console.log(`  Sem assignment (revisão manual): ${unresolved}`);
  if (unresolvedList.length > 0) {
    console.log(`\nInterns para revisão manual:`);
    unresolvedList.forEach((u) => console.log(`  [${u.faculty}] ${u.name}`));
  }

  if (DRY_RUN && assigned > 0) {
    console.log(`\nPara aplicar: node --env-file .env.local --import tsx scripts/backfill-cohort-id.ts --apply`);
  }

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
