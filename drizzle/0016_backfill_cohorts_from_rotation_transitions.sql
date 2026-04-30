-- Backfill cohorts from rotation_transitions (1-para-1).
-- Turmas históricas ficam PLANNED — só admin fecha manualmente com relatório.
INSERT INTO cohorts (
  faculty_id, rotation_number, start_date, end_date, label,
  status, created_by, created_at
)
SELECT
  rt.faculty_id,
  rt.rotation_number,
  rt.start_date,
  rt.end_date,
  COALESCE(rt.label, 'Turma ' || rt.rotation_number),
  CASE
    WHEN rt.start_date <= CURRENT_DATE AND rt.end_date >= CURRENT_DATE THEN 'ACTIVE'
    ELSE 'PLANNED'
  END :: cohort_status,
  (
    SELECT u.id FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.role = 'COORDINATOR' AND ur.is_active = true
    ORDER BY u.created_at ASC LIMIT 1
  ),
  rt.created_at
FROM rotation_transitions rt
ON CONFLICT (faculty_id, rotation_number) DO NOTHING;
