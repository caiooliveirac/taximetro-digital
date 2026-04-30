-- Backfill cohort_id em user_roles para INTERNs ativos.
-- Estratégia: achar o primeiro assignment do intern na faculdade e cruzar com cohorts por janela de data.
-- Interns sem nenhum assignment ficam com cohort_id = NULL (para revisão manual na tela /admin/turmas/atribuir).
UPDATE user_roles ur
SET cohort_id = c.id
FROM (
  SELECT DISTINCT ON (a.intern_id, a.faculty_id)
    a.intern_id,
    a.faculty_id,
    a.date AS first_assignment_date
  FROM assignments a
  ORDER BY a.intern_id, a.faculty_id, a.date ASC
) first_a
JOIN cohorts c
  ON c.faculty_id = first_a.faculty_id
  AND first_a.first_assignment_date BETWEEN c.start_date AND c.end_date
WHERE ur.role = 'INTERN'
  AND ur.faculty_id = first_a.faculty_id
  AND ur.user_id = first_a.intern_id
  AND ur.cohort_id IS NULL;
