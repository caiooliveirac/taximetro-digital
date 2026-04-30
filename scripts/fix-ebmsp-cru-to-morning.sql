-- Corrige assignments de EBMSP/CRU que foram criados como plantão diurno
-- completo (shift IS NULL = 12h) mas que na realidade foram apenas manhã (6h).
--
-- Antes da implementação de Manhã/Tarde, todos os internos CRU/EBMSP eram
-- escalados como DIA inteiro. Este script altera shift NULL → 'MORNING',
-- preservando checkins, checkouts, status, observações etc.
--
-- USO (psql):
--   psql "$DATABASE_URL" -v target_date="'2026-03-30'" -f scripts/fix-ebmsp-cru-to-morning.sql
--
-- Por padrão roda em dry-run (transação revertida). Para efetivar:
--   psql "$DATABASE_URL" -v target_date="'2026-03-30'" -v apply=1 \
--     -f scripts/fix-ebmsp-cru-to-morning.sql
--
-- A data pode ser qualquer dia em que existam assignments CRU/EBMSP com
-- shift NULL que deveriam ser MORNING.

\set ON_ERROR_STOP on
\set QUIET on

-- Default: dry-run quando :apply não é informado.
\if :{?apply}
\else
  \set apply 0
\endif

\if :{?target_date}
\else
  \echo 'ERRO: forneça -v target_date=<YYYY-MM-DD> (com aspas), ex: -v target_date=' '2026-03-30' ''
  \quit 1
\endif

\unset QUIET

\echo
\echo '=== fix-ebmsp-cru-to-morning ==='
\echo 'target_date =' :target_date
\echo 'apply       =' :apply
\echo

BEGIN;

-- IDs das entidades alvo (CRU + EBMSP).
-- Os filtros restantes garantem que só toquemos no que realmente é "diurno cheio".
\echo '--- Antes: assignments CRU/EBMSP na data com shift NULL (= 12h) ---'
SELECT a.id,
       a.intern_id,
       a.date,
       a.period,
       a.shift,
       a.status,
       c.checkin_at,
       c.checkout_at
FROM assignments a
JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
LEFT JOIN checkins c ON c.assignment_id = a.id
WHERE a.date   = :target_date
  AND a.period = 'DAY'
  AND a.shift IS NULL
ORDER BY a.intern_id;

\echo
\echo '--- Conferência: já existem MORNING/AFTERNOON nesse dia? (não devem colidir) ---'
SELECT a.id, a.intern_id, a.shift, a.status
FROM assignments a
JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
WHERE a.date   = :target_date
  AND a.period = 'DAY'
  AND a.shift IN ('MORNING', 'AFTERNOON')
ORDER BY a.intern_id, a.shift;

\echo
\echo '--- Aplicando UPDATE shift = MORNING ---'
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
RETURNING a.id, a.intern_id, a.date, a.period, a.shift, a.status;

\echo
\echo '--- Depois: confirmação ---'
SELECT a.id, a.intern_id, a.shift, a.status
FROM assignments a
JOIN bases     b ON b.id = a.base_id    AND b.code         = 'CRU'
JOIN faculties f ON f.id = a.faculty_id AND f.abbreviation = 'EBMSP'
WHERE a.date   = :target_date
  AND a.period = 'DAY'
ORDER BY a.intern_id, a.shift NULLS FIRST;

\if :apply
  \echo
  \echo '>>> apply=1 → COMMIT'
  COMMIT;
\else
  \echo
  \echo '>>> apply=0 (dry-run) → ROLLBACK (nenhuma alteração persistida)'
  ROLLBACK;
\endif
