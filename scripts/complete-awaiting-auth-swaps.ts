/**
 * Efetiva as trocas que ficaram paradas em AWAITING_AUTH quando a autorização
 * do preceptor foi substituída pela cota de uma troca de CRU por rodízio
 * (2026-07-30). Sem isso elas ficariam presas para sempre: ninguém mais tem
 * tela para autorizá-las.
 *
 * Faz o mesmo que o antigo authorize-swap fazia no "authorize": cancela os dois
 * plantões originais e cria o par trocado.
 *
 * Uso (dentro do container da instância, com DATABASE_URL apontando pra ela):
 *   node --env-file .env.production --import tsx scripts/complete-awaiting-auth-swaps.ts
 *   node --env-file .env.production --import tsx scripts/complete-awaiting-auth-swaps.ts --apply
 *
 * Sem --apply: dry-run, só lista. Com --apply: executa.
 *
 * Pula (e reporta) a troca cujo plantão já mudou de status ou já tem check-in —
 * esses casos precisam de olho humano, não de conclusão automática.
 */
import postgres from "postgres";

const DRY_RUN = !process.argv.includes("--apply");

function fmtDate(d: string) {
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL não definida");
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  console.log(`[complete-awaiting-auth-swaps] modo: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

  const pending = await sql`
    SELECT
      r.id,
      r.requester_id,
      requester.name AS requester_name,
      r.target_intern_id,
      target.name AS target_name,
      orig.id AS orig_id, orig.date AS orig_date, orig.period AS orig_period,
      orig.status AS orig_status, orig.base_id AS orig_base_id, orig.faculty_id AS orig_faculty_id,
      tgt.id AS target_assignment_id, tgt.date AS target_date, tgt.period AS target_period,
      tgt.status AS target_status, tgt.base_id AS target_base_id, tgt.faculty_id AS target_faculty_id,
      (SELECT count(*) FROM checkins c WHERE c.assignment_id IN (orig.id, tgt.id)) AS checkin_count
    FROM requests r
    JOIN users requester ON requester.id = r.requester_id
    LEFT JOIN users target ON target.id = r.target_intern_id
    LEFT JOIN assignments orig ON orig.id = r.assignment_id
    LEFT JOIN assignments tgt ON tgt.id = r.target_assignment_id
    WHERE r.type = 'SWAP' AND r.status = 'AWAITING_AUTH'
    ORDER BY r.created_at
  `;

  console.log(`Trocas em AWAITING_AUTH: ${pending.length}`);

  const MUTABLE = ["SCHEDULED", "CONFIRMED"];
  let completed = 0;
  const skipped: string[] = [];

  for (const row of pending) {
    const label = `${row.requester_name} (${row.orig_date ? fmtDate(row.orig_date) : "?"}) ↔ ${row.target_name ?? "?"} (${row.target_date ? fmtDate(row.target_date) : "?"})`;

    if (!row.orig_id || !row.target_assignment_id || !row.target_intern_id) {
      skipped.push(`${label} — troca incompleta`);
      continue;
    }
    if (!MUTABLE.includes(row.orig_status) || !MUTABLE.includes(row.target_status)) {
      skipped.push(`${label} — plantão já alterado (${row.orig_status}/${row.target_status})`);
      continue;
    }
    if (Number(row.checkin_count) > 0) {
      skipped.push(`${label} — já tem check-in`);
      continue;
    }

    console.log(`  ${DRY_RUN ? "efetivaria" : "efetivando"}: ${label}`);
    if (DRY_RUN) { completed += 1; continue; }

    const requesterNote = `Plantão obtido por troca com ${row.target_name} (cedeu ${fmtDate(row.orig_date)}). Efetivada na migração para cota de troca por rodízio.`;
    const targetNote = `Plantão obtido por troca com ${row.requester_name} (cedeu ${fmtDate(row.target_date)}). Efetivada na migração para cota de troca por rodízio.`;

    await sql.begin(async (tx) => {
      const run = tx as unknown as typeof sql;
      await run`
        UPDATE assignments SET status = 'CANCELLED', notes = 'Trocado via solicitação', updated_at = now()
        WHERE id IN (${row.orig_id}, ${row.target_assignment_id})
      `;
      await run`
        INSERT INTO assignments (intern_id, faculty_id, base_id, date, period, created_by, notes)
        VALUES
          (${row.requester_id}, ${row.orig_faculty_id}, ${row.target_base_id}, ${row.target_date}, ${row.target_period}, ${row.requester_id}, ${requesterNote}),
          (${row.target_intern_id}, ${row.target_faculty_id}, ${row.orig_base_id}, ${row.orig_date}, ${row.orig_period}, ${row.target_intern_id}, ${targetNote})
      `;
      await run`
        UPDATE requests
        SET status = 'COMPLETED', reviewed_at = now(),
            review_notes = 'Troca efetivada na migração para cota de troca por rodízio'
        WHERE id = ${row.id}
      `;
    });

    completed += 1;
  }

  console.log(`\nEfetivadas: ${completed}`);
  if (skipped.length > 0) {
    console.log(`Puladas (${skipped.length}) — precisam de decisão humana:`);
    for (const item of skipped) console.log(`  - ${item}`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
