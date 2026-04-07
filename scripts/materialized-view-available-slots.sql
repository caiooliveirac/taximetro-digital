-- Materialized view: available_slots
-- Shows slot rules with how many are currently filled vs capacity
-- Virtual faculties (PÓS, RESI) appear as normal rules with 0 filled
-- Excludes is_extra_shift from filled count

DROP MATERIALIZED VIEW IF EXISTS available_slots;

CREATE MATERIALIZED VIEW available_slots AS
SELECT
  sr.id AS rule_id,
  sr.base_id,
  b.code AS base_code,
  b.name AS base_name,
  sr.day_of_week,
  sr.period,
  sr.faculty_id,
  f.abbreviation AS faculty_abbr,
  sr.capacity,
  COALESCE(filled.count, 0)::int AS filled,
  (sr.capacity - COALESCE(filled.count, 0))::int AS available
FROM slot_rules sr
JOIN bases b ON b.id = sr.base_id
JOIN faculties f ON f.id = sr.faculty_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS count
  FROM assignments a
  WHERE a.base_id = sr.base_id
    AND a.faculty_id = sr.faculty_id
    AND a.period = sr.period
    AND a.status NOT IN ('CANCELLED')
    AND a.is_extra_shift = false
    AND EXTRACT(DOW FROM a.date::date) = CASE sr.day_of_week
      WHEN 'MON' THEN 1 WHEN 'TUE' THEN 2 WHEN 'WED' THEN 3
      WHEN 'THU' THEN 4 WHEN 'FRI' THEN 5 WHEN 'SAT' THEN 6 WHEN 'SUN' THEN 0
    END
) filled ON true
WHERE sr.is_active = true
ORDER BY sr.day_of_week, b.code, sr.period;

-- Unique index for concurrent refresh
CREATE UNIQUE INDEX idx_available_slots_pk ON available_slots (rule_id);

-- Function to refresh the view
CREATE OR REPLACE FUNCTION refresh_available_slots()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY available_slots;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger on assignments table changes
DROP TRIGGER IF EXISTS trg_refresh_slots ON assignments;
CREATE TRIGGER trg_refresh_slots
AFTER INSERT OR UPDATE OR DELETE ON assignments
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_available_slots();

-- Trigger on slot_rules table changes
DROP TRIGGER IF EXISTS trg_refresh_slots_rules ON slot_rules;
CREATE TRIGGER trg_refresh_slots_rules
AFTER INSERT OR UPDATE OR DELETE ON slot_rules
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_available_slots();

-- Initial refresh
REFRESH MATERIALIZED VIEW available_slots;
