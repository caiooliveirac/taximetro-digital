/**
 * backfill-attendance-actors.ts
 *
 * Retroativamente preenche campos de identificação de validadores em checkins históricos.
 *
 * CASOS COBERTOS:
 *   1. audit_log com userId já resolvido → preenche validated_by / checkout_confirmed_by (UUID)
 *   2. audit_log com userId NULL + telegramName com match único → preenche o UUID
 *   3. audit_log com userId NULL + telegramName sem match → preenche *_name com "Nome - Telegram"
 *
 * IDEMPOTENTE: só atualiza onde o campo-alvo está NULL.
 *
 * Uso:
 *   # Dry-run (padrão — mostra o que seria atualizado):
 *   DATABASE_URL="..." npx tsx scripts/backfill-attendance-actors.ts
 *
 *   # Aplica:
 *   DATABASE_URL="..." npx tsx scripts/backfill-attendance-actors.ts --apply
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não definida.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const sql = postgres(DATABASE_URL, { max: 1 });

function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function buildValidatorNameMap(): Promise<Map<string, string[]>> {
  const rows = await sql`
    SELECT DISTINCT u.id, u.name
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.is_active = true
      AND ur.role IN ('PRECEPTOR', 'LEADER', 'COORDINATOR')
      AND u.is_active = true
  `;
  const map = new Map<string, string[]>();
  for (const { id, name } of rows) {
    const key = normalizeName(name as string);
    const list = map.get(key) ?? [];
    list.push(id as string);
    map.set(key, list);
  }
  return map;
}

async function main() {
  console.log("=".repeat(60));
  console.log(`backfill-attendance-actors — ${APPLY ? "MODO APPLY" : "DRY RUN"}`);
  console.log("=".repeat(60));

  const validatorNameMap = await buildValidatorNameMap();
  console.log(`Usuários ativos (PRECEPTOR/LEADER/COORDINATOR): ${
    new Set([...validatorNameMap.values()].flat()).size
  }\n`);

  let totalUpdated = 0;

  // =========================================================
  // FASE 1A — validated_by via userId direto no audit_log
  // =========================================================
  const p1a = await sql`
    SELECT DISTINCT ON (al.entity_id)
      c.id AS checkin_id,
      al.user_id AS resolved_user_id,
      al.payload->>'telegramName' AS telegram_name
    FROM checkins c
    JOIN (
      SELECT DISTINCT ON (entity_id)
        entity_id, user_id, payload, created_at
      FROM audit_log
      WHERE action IN ('CHECKIN_VALIDATED_TELEGRAM_GROUP', 'CHECKIN_VALIDATED_TELEGRAM_QR')
        AND entity = 'checkin'
        AND user_id IS NOT NULL
      ORDER BY entity_id, created_at ASC
    ) al ON al.entity_id = c.id
    WHERE c.validated_by IS NULL
      AND c.validated_by_name IS NULL
  `;

  console.log(`[1A] validated_by — userId direto no audit_log: ${p1a.length} registros`);
  if (APPLY && p1a.length > 0) {
    const result = await sql`
      UPDATE checkins c
      SET validated_by = al.user_id
      FROM (
        SELECT DISTINCT ON (entity_id) entity_id, user_id
        FROM audit_log
        WHERE action IN ('CHECKIN_VALIDATED_TELEGRAM_GROUP', 'CHECKIN_VALIDATED_TELEGRAM_QR')
          AND entity = 'checkin' AND user_id IS NOT NULL
        ORDER BY entity_id, created_at ASC
      ) al
      WHERE al.entity_id = c.id
        AND c.validated_by IS NULL
        AND c.validated_by_name IS NULL
    `;
    console.log(`  → ${result.count} atualizados`);
    totalUpdated += Number(result.count);
  }

  // =========================================================
  // FASE 1B — validated_by via name-matching OU nome salvo
  // =========================================================
  const p1b_raw = await sql`
    SELECT DISTINCT ON (al.entity_id)
      al.entity_id AS checkin_id,
      al.payload->>'telegramName' AS telegram_name
    FROM audit_log al
    JOIN checkins c ON c.id = al.entity_id
    WHERE al.action IN ('CHECKIN_VALIDATED_TELEGRAM_GROUP', 'CHECKIN_VALIDATED_TELEGRAM_QR')
      AND al.entity = 'checkin'
      AND al.user_id IS NULL
      AND al.payload->>'telegramName' IS NOT NULL
      AND c.validated_by IS NULL
      AND c.validated_by_name IS NULL
    ORDER BY al.entity_id, al.created_at ASC
  `;

  const p1b_uuid: { checkinId: string; userId: string; telegramName: string }[] = [];
  const p1b_name: { checkinId: string; displayName: string }[] = [];

  for (const r of p1b_raw) {
    const norm = normalizeName(r.telegram_name as string);
    const matches = validatorNameMap.get(norm) ?? [];
    if (matches.length === 1) {
      p1b_uuid.push({ checkinId: r.checkin_id as string, userId: matches[0], telegramName: r.telegram_name as string });
    } else {
      p1b_name.push({ checkinId: r.checkin_id as string, displayName: `${r.telegram_name} - Telegram` });
    }
  }

  console.log(`[1B] validated_by — name-match único: ${p1b_uuid.length} | sem conta (nome salvo): ${p1b_name.length}`);
  if (p1b_uuid.length > 0 && !APPLY) {
    p1b_uuid.slice(0, 3).forEach((u) => console.log(`     ${u.checkinId} → user "${u.telegramName}"`));
  }
  if (p1b_name.length > 0 && !APPLY) {
    p1b_name.slice(0, 3).forEach((u) => console.log(`     ${u.checkinId} → nome "${u.displayName}"`));
  }

  if (APPLY) {
    for (const u of p1b_uuid) {
      await sql`UPDATE checkins SET validated_by = ${u.userId} WHERE id = ${u.checkinId}::uuid AND validated_by IS NULL AND validated_by_name IS NULL`;
    }
    for (const u of p1b_name) {
      await sql`UPDATE checkins SET validated_by_name = ${u.displayName} WHERE id = ${u.checkinId}::uuid AND validated_by IS NULL AND validated_by_name IS NULL`;
    }
    console.log(`  → ${p1b_uuid.length + p1b_name.length} atualizados`);
    totalUpdated += p1b_uuid.length + p1b_name.length;
  }

  // =========================================================
  // FASE 2A — checkout_confirmed_by via userId direto
  // =========================================================
  const p2a = await sql`
    SELECT
      c.id AS checkin_id,
      al.user_id AS resolved_user_id
    FROM checkins c
    JOIN assignments a ON a.id = c.assignment_id
    JOIN (
      SELECT DISTINCT ON (entity_id)
        entity_id, user_id, created_at
      FROM audit_log
      WHERE action IN ('CHECKOUT_VALIDATED_TELEGRAM_GROUP', 'CHECKOUT_VALIDATED_TELEGRAM_QR', 'CHECKOUT_CONFIRMED')
        AND entity = 'assignment'
        AND user_id IS NOT NULL
      ORDER BY entity_id, created_at ASC
    ) al ON al.entity_id = a.id
    WHERE c.checkout_confirmed_by IS NULL
      AND c.checkout_confirmed_by_name IS NULL
      AND c.checkout_at IS NOT NULL
  `;

  console.log(`\n[2A] checkout_confirmed_by — userId direto no audit_log: ${p2a.length} registros`);
  if (APPLY && p2a.length > 0) {
    const result = await sql`
      UPDATE checkins c
      SET checkout_confirmed_by = al.user_id
      FROM assignments a,
      (
        SELECT DISTINCT ON (entity_id) entity_id, user_id
        FROM audit_log
        WHERE action IN ('CHECKOUT_VALIDATED_TELEGRAM_GROUP', 'CHECKOUT_VALIDATED_TELEGRAM_QR', 'CHECKOUT_CONFIRMED')
          AND entity = 'assignment' AND user_id IS NOT NULL
        ORDER BY entity_id, created_at ASC
      ) al
      WHERE c.assignment_id = a.id
        AND al.entity_id = a.id
        AND c.checkout_confirmed_by IS NULL
        AND c.checkout_confirmed_by_name IS NULL
        AND c.checkout_at IS NOT NULL
    `;
    console.log(`  → ${result.count} atualizados`);
    totalUpdated += Number(result.count);
  }

  // =========================================================
  // FASE 2B — checkout_confirmed_by via name-match OU nome salvo
  // =========================================================
  const p2b_raw = await sql`
    SELECT DISTINCT ON (al.entity_id)
      al.entity_id AS assignment_id,
      al.payload->>'telegramName' AS telegram_name
    FROM audit_log al
    JOIN assignments a ON a.id = al.entity_id
    JOIN checkins c ON c.assignment_id = a.id
    WHERE al.action IN ('CHECKOUT_VALIDATED_TELEGRAM_GROUP', 'CHECKOUT_VALIDATED_TELEGRAM_QR')
      AND al.entity = 'assignment'
      AND al.user_id IS NULL
      AND al.payload->>'telegramName' IS NOT NULL
      AND c.checkout_confirmed_by IS NULL
      AND c.checkout_confirmed_by_name IS NULL
      AND c.checkout_at IS NOT NULL
    ORDER BY al.entity_id, al.created_at ASC
  `;

  const p2b_uuid: { checkinId: string; userId: string; telegramName: string }[] = [];
  const p2b_name: { checkinId: string; displayName: string }[] = [];

  if (p2b_raw.length > 0) {
    const assignmentIds = p2b_raw.map((r) => r.assignment_id as string);
    const checkinRows = await sql`
      SELECT id AS checkin_id, assignment_id
      FROM checkins
      WHERE assignment_id = ANY(${assignmentIds}::uuid[])
        AND checkout_confirmed_by IS NULL
        AND checkout_confirmed_by_name IS NULL
        AND checkout_at IS NOT NULL
    `;
    const assignmentToCheckin = new Map<string, string>();
    for (const row of checkinRows) {
      assignmentToCheckin.set(row.assignment_id as string, row.checkin_id as string);
    }

    for (const r of p2b_raw) {
      const checkinId = assignmentToCheckin.get(r.assignment_id as string);
      if (!checkinId) continue;
      const norm = normalizeName(r.telegram_name as string);
      const matches = validatorNameMap.get(norm) ?? [];
      if (matches.length === 1) {
        p2b_uuid.push({ checkinId, userId: matches[0], telegramName: r.telegram_name as string });
      } else {
        p2b_name.push({ checkinId, displayName: `${r.telegram_name} - Telegram` });
      }
    }
  }

  console.log(`[2B] checkout_confirmed_by — name-match único: ${p2b_uuid.length} | sem conta (nome salvo): ${p2b_name.length}`);
  if (p2b_name.length > 0 && !APPLY) {
    p2b_name.slice(0, 3).forEach((u) => console.log(`     ${u.checkinId} → nome "${u.displayName}"`));
  }

  if (APPLY) {
    for (const u of p2b_uuid) {
      await sql`UPDATE checkins SET checkout_confirmed_by = ${u.userId} WHERE id = ${u.checkinId}::uuid AND checkout_confirmed_by IS NULL AND checkout_confirmed_by_name IS NULL`;
    }
    for (const u of p2b_name) {
      await sql`UPDATE checkins SET checkout_confirmed_by_name = ${u.displayName} WHERE id = ${u.checkinId}::uuid AND checkout_confirmed_by IS NULL AND checkout_confirmed_by_name IS NULL`;
    }
    console.log(`  → ${p2b_uuid.length + p2b_name.length} atualizados`);
    totalUpdated += p2b_uuid.length + p2b_name.length;
  }

  // =========================================================
  // RESUMO
  // =========================================================
  const total =
    p1a.length + p1b_uuid.length + p1b_name.length +
    p2a.length + p2b_uuid.length + p2b_name.length;

  console.log("\n" + "=".repeat(60));
  if (APPLY) {
    console.log(`Backfill concluído. Total de linhas atualizadas: ${totalUpdated}`);
  } else {
    console.log(`Dry run. Seriam atualizadas ${total} linhas:`);
    console.log(`  validated_by (UUID):               ${p1a.length + p1b_uuid.length}`);
    console.log(`  validated_by_name (texto):         ${p1b_name.length}`);
    console.log(`  checkout_confirmed_by (UUID):      ${p2a.length + p2b_uuid.length}`);
    console.log(`  checkout_confirmed_by_name (texto):${p2b_name.length}`);
    console.log("Execute com --apply para aplicar.");
  }
  console.log("=".repeat(60));

  await sql.end();
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
