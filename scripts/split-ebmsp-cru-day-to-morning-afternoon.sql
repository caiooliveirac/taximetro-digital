-- Split de assignments CRU/EBMSP "diurno cheio" (shift IS NULL = 12h) em
-- MORNING + AFTERNOON (6h + 6h), preservando todo o histórico de checkin.
--
-- Para cada assignment alvo:
--   1. Atualiza o existente: shift NULL → 'MORNING'
--   2. Cria um novo assignment AFTERNOON clonando os campos
--   3. Clona o registro de checkins (mesmos timestamps, status, validador,
--      observações) para o novo assignment, para preservar evidência de
--      presença nos dois turnos.
--
-- USO (dry-run, default):
--   psql "$DATABASE_URL" -v target_date="'2026-04-02'" \
--     -f scripts/split-ebmsp-cru-day-to-morning-afternoon.sql
--
-- Para efetivar:
--   psql "$DATABASE_URL" -v target_date="'2026-04-02'" -v apply=1 \
--     -f scripts/split-ebmsp-cru-day-to-morning-afternoon.sql

\set ON_ERROR_STOP on

\if :{?apply}
\else
  \set apply 0
\endif

\if :{?target_date}
\else
  \echo 'ERRO: forneça -v target_date=<YYYY-MM-DD> entre aspas simples'
  \quit 1
\endif

\echo
\echo '=== split-ebmsp-cru-day-to-morning-afternoon ==='
\echo 'target_date =' :target_date
\echo 'apply       =' :apply
\echo

BEGIN;

\echo '--- Antes: assignments CRU/EBMSP DAY/shift NULL ---'
SELECT a.id, a.intern_id, u.name, a.status,
       c.id AS checkin_id, c.checkin_at, c.checkout_at
FROM assignments a
JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
JOIN users     u ON u.id = a.intern_id
LEFT JOIN checkins c ON c.assignment_id = a.id
WHERE a.date   = :target_date
  AND a.period = 'DAY'
  AND a.shift IS NULL
ORDER BY u.name;

\echo
\echo '--- Verificação: já existem AFTERNOON nesse dia (potencial colisão)? ---'
SELECT a.id, a.intern_id, u.name, a.shift, a.status
FROM assignments a
JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
JOIN users     u ON u.id = a.intern_id
WHERE a.date   = :target_date
  AND a.period = 'DAY'
  AND a.shift  = 'AFTERNOON'
  AND a.intern_id IN (
    SELECT a2.intern_id FROM assignments a2
    JOIN bases b2     ON b2.id = a2.base_id    AND b2.code         = 'CRU'
    JOIN faculties f2 ON f2.id = a2.faculty_id AND f2.abbreviation = 'EBMSP'
    WHERE a2.date = :target_date AND a2.period = 'DAY' AND a2.shift IS NULL
  );

\echo
\echo '--- Step 1: UPDATE shift NULL -> MORNING ---'
WITH target AS (
  SELECT a.id
  FROM assignments a
  JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
  JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
  WHERE a.date   = :target_date
    AND a.period = 'DAY'
    AND a.shift IS NULL
)
UPDATE assignments a
SET shift      = 'MORNING',
    updated_at = NOW()
FROM target
WHERE a.id = target.id
RETURNING a.id AS morning_assignment_id, a.intern_id, a.status;

\echo
\echo '--- Step 2: INSERT AFTERNOON clones ---'
WITH morning AS (
  SELECT a.*
  FROM assignments a
  JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
  JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
  WHERE a.date   = :target_date
    AND a.period = 'DAY'
    AND a.shift  = 'MORNING'
    -- só os que acabamos de transformar: tem checkin com checkout no mesmo dia
    AND EXISTS (
      SELECT 1 FROM checkins c
      WHERE c.assignment_id = a.id
        AND c.checkout_at IS NOT NULL
    )
)
INSERT INTO assignments (
  intern_id, faculty_id, base_id, date, period, shift, status,
  is_extra_shift, extra_shift_notes,
  created_by, notes,
  absence_justification, absence_justification_actor, absence_justification_at,
  created_at, updated_at
)
SELECT
  intern_id, faculty_id, base_id, date, period, 'AFTERNOON', status,
  is_extra_shift, extra_shift_notes,
  created_by, notes,
  absence_justification, absence_justification_actor, absence_justification_at,
  NOW(), NOW()
FROM morning
RETURNING id AS afternoon_assignment_id, intern_id, shift, status;

\echo
\echo '--- Step 3: clonar checkins para o assignment AFTERNOON ---'
WITH pairs AS (
  SELECT
    am.id AS morning_id,
    aa.id AS afternoon_id,
    am.intern_id
  FROM assignments am
  JOIN bases     b ON b.id = am.base_id    AND b.code         = 'CRU'
  JOIN faculties f ON f.id = am.faculty_id AND f.abbreviation = 'EBMSP'
  JOIN assignments aa
    ON aa.intern_id  = am.intern_id
   AND aa.date       = am.date
   AND aa.period     = 'DAY'
   AND aa.shift      = 'AFTERNOON'
  WHERE am.date   = :target_date
    AND am.period = 'DAY'
    AND am.shift  = 'MORNING'
    AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.assignment_id = aa.id)
)
INSERT INTO checkins (
  assignment_id, intern_id,
  checkin_lat, checkin_lng, geo_distance_meters, geo_valid,
  checkin_at,
  totp_secret, totp_validated_at, validated_by,
  method,
  intern_observations, preceptor_observations,
  status,
  checkout_at, checkout_confirmed_by, checkout_notes
)
SELECT
  p.afternoon_id, p.intern_id,
  c.checkin_lat, c.checkin_lng, c.geo_distance_meters, c.geo_valid,
  c.checkin_at,
  NULL, c.totp_validated_at, c.validated_by,
  c.method,
  c.intern_observations, c.preceptor_observations,
  c.status,
  c.checkout_at, c.checkout_confirmed_by, c.checkout_notes
FROM pairs p
JOIN checkins c ON c.assignment_id = p.morning_id
RETURNING id AS new_checkin_id, assignment_id, intern_id, checkin_at, checkout_at;

\echo
\echo '--- Depois: estado final do dia ---'
SELECT a.id, u.name, a.shift, a.status,
       c.id AS checkin_id, c.checkin_at, c.checkout_at
FROM assignments a
JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
JOIN users     u ON u.id = a.intern_id
LEFT JOIN checkins c ON c.assignment_id = a.id
WHERE a.date   = :target_date
  AND a.period = 'DAY'
ORDER BY u.name, a.shift NULLS FIRST;

\if :apply
  \echo
  \echo '>>> apply=1 → COMMIT'
  COMMIT;
\else
  \echo
  \echo '>>> apply=0 (dry-run) → ROLLBACK'
  ROLLBACK;
\endif
