/**
 * backfill-attendance-window.ts
 *
 * Lança check-in + checkout retroativos, EM MASSA, para os plantões de uma
 * janela de datas — reproduzindo exatamente o que acontece quando o
 * coordenador abre o modal do interno em /admin/escalas e clica
 * "Confirmar presença" e depois "Confirmar checkout".
 *
 * Caso de uso: o sistema ficou fora do ar entre 14 e 21/07 e ninguém
 * conseguiu bater ponto; esses plantões ficaram presos em SCHEDULED/CONFIRMED.
 *
 * FIDELIDADE AO MODAL
 *   Replica, byte a byte, os writes de `executeManualAttendance`
 *   (src/features/admin-attendance/application/use-cases/handle-manual-attendance.ts):
 *     - Horário "plausível" sintético (mesma função pickPlausibleShiftTimes):
 *         DAY   → check-in 06:55–07:10, checkout 18:55–19:10 (mesma data)
 *         NIGHT → check-in 18:55–19:10, checkout 06:55–07:10 (data + 1)
 *       fuso America/Bahia (UTC-3, sem DST). Guarda o mesmo instante que o
 *       modal gravaria; o app lê a coluna timestamp como UTC e converte p/ BR.
 *     - checkins: status VALIDATED, method APP_DIRECT, geo_valid=true,
 *       validated_by / checkout_confirmed_by = coordenador, totp_validated_at.
 *     - assignments: SCHEDULED/CONFIRMED/ABSENT → CHECKED_IN → CHECKED_OUT,
 *       limpando os campos de absenceJustification*.
 *     - qr_sessions pendentes consumidas.
 *     - audit_log: MANUAL_ATTENDANCE_CONFIRMED + MANUAL_CHECKOUT_CONFIRMED,
 *       com o mesmo payload (inclui retroactive=true).
 *     - Clamp de segurança: checkout_at >= checkin_at + 11h.
 *
 * Self-contained (só depende de `postgres` + DATABASE_URL), igual ao
 * scripts/backfill-attendance-actors.ts — roda no host de produção sem o
 * build do app.
 *
 * SEGURANÇA
 *   - Dry-run é o padrão. Só grava com --apply.
 *   - Idempotente: alvo é só SCHEDULED/CONFIRMED (e ABSENT com --include-absent);
 *     quem já está CHECKED_IN/CHECKED_OUT/CANCELLED nunca é tocado. Reexecutar
 *     não duplica.
 *   - FAÇA BACKUP antes de rodar com --apply.
 *
 * USO (no host de produção):
 *   DATABASE_URL="postgres://..." npx tsx scripts/backfill-attendance-window.ts            # dry-run
 *   DATABASE_URL="postgres://..." npx tsx scripts/backfill-attendance-window.ts --apply    # grava
 *
 * FLAGS
 *   --apply                grava (sem isso é dry-run)
 *   --from=YYYY-MM-DD      início da janela (default 2026-07-14)
 *   --to=YYYY-MM-DD        fim, inclusivo (default 2026-07-21)
 *   --include-absent       também converte plantões ABSENT em presença
 *   --actor-email=EMAIL    coordenador que consta como validador
 *                          (default caio.olive94@gmail.com)
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não definida.");
  process.exit(1);
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
}

const APPLY = process.argv.includes("--apply");
const INCLUDE_ABSENT = process.argv.includes("--include-absent");
const FROM = arg("from", "2026-07-14");
const TO = arg("to", "2026-07-21");
const ACTOR_EMAIL = arg("actor-email", "caio.olive94@gmail.com");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_RE.test(FROM) || !DATE_RE.test(TO)) {
  console.error(`ERRO: --from/--to devem estar em YYYY-MM-DD (from=${FROM} to=${TO}).`);
  process.exit(1);
}
if (FROM > TO) {
  console.error(`ERRO: --from (${FROM}) é posterior a --to (${TO}).`);
  process.exit(1);
}

const TARGET_STATUSES = INCLUDE_ABSENT
  ? ["SCHEDULED", "CONFIRMED", "ABSENT"]
  : ["SCHEDULED", "CONFIRMED"];

// ───────────────────────── horário plausível ─────────────────────────
// Cópia fiel de src/features/admin-attendance/application/plausible-shift-times.ts
const BAHIA_UTC_OFFSET_HOURS = 3;

interface Window { startHour: number; startMinute: number; endHour: number; endMinute: number; dayOffset: number; }
const CHECKIN_DAY: Window = { startHour: 6, startMinute: 55, endHour: 7, endMinute: 10, dayOffset: 0 };
const CHECKOUT_DAY: Window = { startHour: 18, startMinute: 55, endHour: 19, endMinute: 10, dayOffset: 0 };
const CHECKIN_NIGHT: Window = { startHour: 18, startMinute: 55, endHour: 19, endMinute: 10, dayOffset: 0 };
const CHECKOUT_NIGHT: Window = { startHour: 6, startMinute: 55, endHour: 7, endMinute: 10, dayOffset: 1 };

function parseLocalDate(dateStr: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`assignment date inválido: ${dateStr}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}
function pickInWindow(base: { year: number; month: number; day: number }, win: Window): Date {
  const startTotal = win.startHour * 60 + win.startMinute;
  const endTotal = win.endHour * 60 + win.endMinute;
  const minuteTotal = startTotal + Math.floor(Math.random() * (endTotal - startTotal + 1));
  const hour = Math.floor(minuteTotal / 60);
  const minute = minuteTotal % 60;
  const second = Math.floor(Math.random() * 60);
  return new Date(Date.UTC(base.year, base.month - 1, base.day + win.dayOffset, hour + BAHIA_UTC_OFFSET_HOURS, minute, second));
}
function pickPlausibleShiftTimes(date: string, period: "DAY" | "NIGHT") {
  const base = parseLocalDate(date);
  return {
    checkinAt: pickInWindow(base, period === "DAY" ? CHECKIN_DAY : CHECKIN_NIGHT),
    checkoutAt: pickInWindow(base, period === "DAY" ? CHECKOUT_DAY : CHECKOUT_NIGHT),
  };
}

/**
 * String ISO-8601 com sufixo Z. É EXATAMENTE como o Drizzle serializa um Date
 * para uma coluna `timestamp` sem fuso: o Postgres descarta o offset e guarda
 * os componentes UTC verbatim (ex.: 06:55 Bahia → instante 09:55Z → grava
 * "2026-xx-xx 09:55"; o app relê como UTC e mostra 06:55).
 *
 * Verificado empiricamente contra o Drizzle nesta base (sessão TimeZone
 * America/Bahia): passar o Date cru gravaria o horário local (-3h) e um
 * literal sem Z gravaria +3h — só o .toISOString() bate byte a byte.
 */
function toUtcLiteral(d: Date): string {
  return d.toISOString();
}
// ──────────────────────────────────────────────────────────────────────

const sql = postgres(DATABASE_URL, { max: 1 });

function localDateStrBrazil(d = new Date()): string {
  // YYYY-MM-DD no fuso America/Sao_Paulo (equivalente ao localDateStr do app)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function fmtPeriod(period: string, shift: string | null): string {
  const base = period === "DAY" ? "Diurno" : "Noturno";
  if (shift === "MORNING") return `${base}/Manhã`;
  if (shift === "AFTERNOON") return `${base}/Tarde`;
  return base;
}

async function main() {
  console.log("=".repeat(64));
  console.log(`backfill-attendance-window — ${APPLY ? "MODO APPLY (grava!)" : "DRY RUN"}`);
  console.log(`janela: ${FROM} … ${TO} (inclusivo)`);
  console.log(`status-alvo: ${TARGET_STATUSES.join(", ")}`);
  console.log(`ator (validador): ${ACTOR_EMAIL}`);
  console.log("=".repeat(64));

  const [actor] = await sql`SELECT id, name FROM users WHERE email = ${ACTOR_EMAIL} LIMIT 1`;
  if (!actor) { console.error(`ERRO: nenhum usuário com email ${ACTOR_EMAIL}.`); await sql.end(); process.exit(1); }
  const [coord] = await sql`SELECT 1 FROM user_roles WHERE user_id = ${actor.id} AND role = 'COORDINATOR' LIMIT 1`;
  if (!coord) console.warn(`AVISO: ${ACTOR_EMAIL} não tem role COORDINATOR — seguindo mesmo assim.`);
  console.log(`ator resolvido: ${actor.name} (${actor.id})\n`);

  const targets = await sql`
    SELECT a.id, a.intern_id, a.faculty_id, a.date::text AS date, a.period, a.shift, a.status,
           u.name AS intern_name, b.code AS base_code, f.abbreviation AS faculty_abbr
    FROM assignments a
    JOIN users u ON u.id = a.intern_id
    JOIN bases b ON b.id = a.base_id
    JOIN faculties f ON f.id = a.faculty_id
    WHERE a.date BETWEEN ${FROM} AND ${TO}
      AND a.status IN ${sql(TARGET_STATUSES)}
    ORDER BY a.date, a.period`;

  console.log(`Plantões-alvo encontrados: ${targets.length}\n`);
  if (targets.length === 0) { console.log("Nada a fazer."); await sql.end(); return; }

  const byDate = new Map<string, number>(), byPeriod = new Map<string, number>(), byStatus = new Map<string, number>();
  for (const t of targets) {
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + 1);
    const p = fmtPeriod(t.period, t.shift);
    byPeriod.set(p, (byPeriod.get(p) ?? 0) + 1);
    byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
  }
  console.log("Por data:"); [...byDate].sort().forEach(([d, n]) => console.log(`  ${d}: ${n}`));
  console.log("Por turno:"); [...byPeriod].sort().forEach(([p, n]) => console.log(`  ${p}: ${n}`));
  console.log("Por status atual:"); [...byStatus].sort().forEach(([s, n]) => console.log(`  ${s}: ${n}`));
  console.log("");

  if (!APPLY) {
    console.log("Amostra (até 10 plantões que seriam lançados presente+checkout):");
    targets.slice(0, 10).forEach((t) =>
      console.log(`  ${t.date} ${fmtPeriod(t.period, t.shift).padEnd(14)} ${String(t.base_code).padEnd(6)} ${String(t.faculty_abbr).padEnd(6)} ${t.intern_name}`));
    console.log("\nDry run. Nada foi gravado. Rode com --apply para efetivar.");
    await sql.end();
    return;
  }

  const today = localDateStrBrazil();
  let checkedOut = 0;
  const failures: { id: string; error: string }[] = [];

  for (const [i, t] of targets.entries()) {
    const tag = `[${i + 1}/${targets.length}] ${t.date} ${fmtPeriod(t.period, t.shift)} ${t.base_code} ${t.intern_name}`;
    const retroactive = t.date < today;
    const { checkinAt, checkoutAt: rawCheckout } = pickPlausibleShiftTimes(t.date, t.period);
    // clamp: checkout >= checkin + 11h
    const minCheckout = new Date(checkinAt.getTime() + 11 * 60 * 60 * 1000);
    const checkoutAt = rawCheckout < minCheckout ? minCheckout : rawCheckout;
    // literais UTC (idêntico ao Drizzle) para as colunas timestamp sem fuso
    const checkinLit = toUtcLiteral(checkinAt);
    const checkoutLit = toUtcLiteral(checkoutAt);

    try {
      await sql.begin(async (txRaw) => {
        // postgres.js tipa o param da transação sem call-signature; tratamos
        // como o mesmo tipo do `sql` (callable + .json) para o TS.
        const tx = txRaw as unknown as typeof sql;
        const [existing] = await tx`SELECT id, status, checkin_at FROM checkins WHERE assignment_id = ${t.id} LIMIT 1`;

        // ── CONFIRM_PRESENT ──
        let checkinId: string;
        if (existing) {
          await tx`UPDATE checkins SET checkin_at = ${checkinLit}, geo_valid = true, status = 'VALIDATED',
                   validated_by = ${actor.id}, totp_validated_at = ${checkinLit}, method = 'APP_DIRECT'
                   WHERE id = ${existing.id}`;
          checkinId = existing.id;
        } else {
          const [ins] = await tx`INSERT INTO checkins (assignment_id, intern_id, checkin_at, geo_valid, status, validated_by, totp_validated_at, method)
                   VALUES (${t.id}, ${t.intern_id}, ${checkinLit}, true, 'VALIDATED', ${actor.id}, ${checkinLit}, 'APP_DIRECT')
                   RETURNING id`;
          checkinId = ins.id;
        }
        await tx`UPDATE qr_sessions SET consumed_at = now(), consumed_by = ${actor.id}
                 WHERE checkin_id = ${checkinId} AND consumed_at IS NULL`;
        await tx`UPDATE assignments SET status = 'CHECKED_IN', absence_justification = NULL,
                 absence_justification_actor = NULL, absence_justification_at = NULL, updated_at = now()
                 WHERE id = ${t.id}`;
        await tx`INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
                 VALUES (${actor.id}, 'MANUAL_ATTENDANCE_CONFIRMED', 'assignment', ${t.id},
                 ${tx.json({ previousStatus: t.status, previousCheckinStatus: existing?.status ?? null,
                   internId: t.intern_id, facultyId: t.faculty_id, retroactive,
                   syntheticCheckinAt: checkinAt.toISOString(),
                   previousCheckinAt: existing?.checkin_at ? new Date(existing.checkin_at).toISOString() : null })})`;

        // ── CONFIRM_CHECKOUT ──
        await tx`UPDATE assignments SET status = 'CHECKED_OUT', absence_justification = NULL,
                 absence_justification_actor = NULL, absence_justification_at = NULL, updated_at = now()
                 WHERE id = ${t.id}`;
        await tx`UPDATE checkins SET checkout_at = ${checkoutLit}, checkout_confirmed_by = ${actor.id},
                 checkout_notes = 'Checkout confirmado manualmente pelo admin' WHERE id = ${checkinId}`;
        await tx`UPDATE qr_sessions SET consumed_at = now(), consumed_by = ${actor.id}
                 WHERE checkin_id = ${checkinId} AND consumed_at IS NULL`;
        await tx`INSERT INTO audit_log (user_id, action, entity, entity_id, payload)
                 VALUES (${actor.id}, 'MANUAL_CHECKOUT_CONFIRMED', 'assignment', ${t.id},
                 ${tx.json({ previousStatus: "CHECKED_IN", previousCheckinStatus: "VALIDATED",
                   internId: t.intern_id, facultyId: t.faculty_id, retroactive,
                   syntheticCheckoutAt: checkoutAt.toISOString() })})`;
      });
      checkedOut++;
      if ((i + 1) % 25 === 0 || i === targets.length - 1) console.log(`  … ${i + 1}/${targets.length} processados`);
    } catch (e) {
      failures.push({ id: t.id, error: (e as Error).message });
      console.log(`  ✗ ${tag} — falhou: ${(e as Error).message}`);
    }
  }

  console.log("\n" + "=".repeat(64));
  console.log(`Presença + checkout confirmados: ${checkedOut}/${targets.length}`);
  if (failures.length) {
    console.log(`Falhas: ${failures.length}`);
    failures.slice(0, 20).forEach((f) => console.log(`  ${f.id}: ${f.error}`));
  } else console.log("Sem falhas.");
  console.log("=".repeat(64));

  await sql.end();
}

main().catch(async (err) => { console.error("Erro fatal:", err); await sql.end().catch(() => {}); process.exit(1); });
