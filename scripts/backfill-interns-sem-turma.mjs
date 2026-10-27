/**
 * Põe numa turma os internos ativos que ficaram sem turma (cohort_id NULL).
 * Mesma regra de src/features/cohorts/domain/intern-cohort.ts: entra na turma
 * aberta da faculdade (não fechada, fim >= hoje; ACTIVE antes de PLANNED, a
 * mais recente primeiro); sem nenhuma, cria a próxima — começa hoje e dura o
 * mesmo que a última.
 *
 * Roda dentro do container de produção (tem DATABASE_URL e o pacote postgres):
 *   docker exec taximetro-digital node scripts/backfill-interns-sem-turma.mjs --faculty AFYA
 *   docker exec taximetro-digital node scripts/backfill-interns-sem-turma.mjs --faculty AFYA --apply
 *
 * Sem --apply: dry-run. --faculty aceita a sigla e pode repetir; sem ela,
 * todas as faculdades.
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const FACULTIES = process.argv.flatMap((arg, i, all) => (arg === "--faculty" && all[i + 1] ? [all[i + 1]] : []));
const DEFAULT_ROTATION_DAYS = 41;

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definida");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  console.log(`[backfill-interns-sem-turma] ${APPLY ? "APPLY" : "DRY-RUN"} hoje=${today} faculdades=${FACULTIES.join(",") || "todas"}`);

  const orphans = await sql`
    SELECT ur.id AS user_role_id, u.name, f.id AS faculty_id, f.abbreviation
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN faculties f ON f.id = ur.faculty_id
    WHERE ur.role = 'INTERN' AND ur.is_active AND NOT ur.is_archived AND ur.cohort_id IS NULL
      AND u.merged_into_user_id IS NULL
      ${FACULTIES.length ? sql`AND f.abbreviation IN ${sql(FACULTIES)}` : sql``}
    ORDER BY f.abbreviation, u.name
  `;

  const byFaculty = Map.groupBy(orphans, (row) => row.faculty_id);
  for (const [facultyId, rows] of byFaculty) {
    const abbr = rows[0].abbreviation;
    const cohorts = await sql`
      SELECT id, label, status, rotation_number, start_date::text AS start_date, end_date::text AS end_date
      FROM cohorts WHERE faculty_id = ${facultyId}
    `;
    const open = cohorts
      .filter((c) => c.status !== "CLOSED" && c.end_date >= today)
      .sort((a, b) => Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || b.start_date.localeCompare(a.start_date))[0];

    let cohortId = open?.id;
    let cohortLabel = open?.label;
    if (!open) {
      const last = cohorts.reduce((acc, c) => (!acc || c.rotation_number > acc.rotation_number ? c : acc), null);
      const rotationNumber = (last?.rotation_number ?? 0) + 1;
      const length = last ? Math.max(daysBetween(last.start_date, last.end_date), 7) : DEFAULT_ROTATION_DAYS;
      const plan = { rotationNumber, startDate: today, endDate: addDays(today, length), name: `${abbr} ${rotationNumber}` };
      cohortLabel = `${plan.name} (nova: ${plan.startDate} → ${plan.endDate})`;

      if (APPLY) {
        // Autor da turma: quem gerou o convite mais recente da faculdade, senão um coordenador.
        const [actor] = await sql`
          SELECT created_by AS id FROM invite_links WHERE faculty_id = ${facultyId} ORDER BY created_at DESC LIMIT 1
        `;
        const [coordinator] = actor ? [actor] : await sql`
          SELECT user_id AS id FROM user_roles WHERE role = 'COORDINATOR' AND is_active ORDER BY id LIMIT 1
        `;
        const [created] = await sql`
          INSERT INTO cohorts (faculty_id, rotation_number, start_date, end_date, name, label, status, created_by)
          VALUES (${facultyId}, ${plan.rotationNumber}, ${plan.startDate}, ${plan.endDate}, ${plan.name}, ${plan.name}, 'ACTIVE', ${coordinator.id})
          RETURNING id
        `;
        cohortId = created.id;
        await sql`
          INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
          VALUES (${coordinator.id}, 'AUTO_CREATE_COHORT', 'cohort', ${cohortId}, ${sql.json({ ...plan, facultyId, reason: "backfill" })})
        `;
      }
    }

    console.log(`\n${abbr}: ${rows.length} interno(s) → ${cohortLabel}`);
    for (const row of rows) console.log(`  - ${row.name}`);

    if (APPLY) {
      const ids = rows.map((row) => row.user_role_id);
      await sql`UPDATE user_roles SET cohort_id = ${cohortId} WHERE id IN ${sql(ids)} AND cohort_id IS NULL`;
      await sql`
        INSERT INTO audit_log (action, entity, entity_id, payload)
        VALUES ('BULK_ASSIGN_COHORT', 'cohort', ${cohortId}, ${sql.json({ userRoleIds: ids, count: ids.length, reason: "backfill" })})
      `;
    }
  }

  if (orphans.length === 0) console.log("Nenhum interno ativo sem turma.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
