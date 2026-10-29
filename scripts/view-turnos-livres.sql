-- turnos_livres: turno livre por DATA, não por regra semanal.
--
-- Substitui a materialized view available_slots, que contava os plantões de
-- toda a história por dia da semana (a coluna "available" ficava negativa),
-- não era lida por nenhum código e, pelos triggers trg_refresh_slots e
-- trg_refresh_slots_rules, fazia REFRESH (~0,6 s) dentro de toda escrita em
-- assignments e slot_rules.
--
-- Aqui só fatos, sem regra de negócio: para cada data dos próximos 45 dias,
-- base, turno e faculdade dona da grade —
--   capacidade          vagas da grade (regras ativas, não extra, não bloqueadas)
--   ocupadas            plantões da própria faculdade no turno (fora cancelado,
--                       falta, extra e o que veio de vaga livre de outra)
--   liberadas_abertas   a faculdade abriu mão e ninguém pegou
--   liberadas_usadas    a faculdade abriu mão e alguém pegou (inclui troca)
--   reservadas          a coordenação segurou a vaga
--   sobra               turno da grade que ninguém usou, liberou nem reservou
-- e, com faculty_id nulo, as vagas sem dono (excedente físico da base,
-- auto-release-slots.ts) ainda abertas.
--
-- View comum: sempre fresca, sem refresh e sem trigger. O drizzle-kit push
-- derruba view que ele não conhece; o job db_changes do deploy roda este
-- script depois do push para recriar.
--
-- A remoção da função antiga exige o dono dela (role postgres em produção).
-- Feita à mão em 2026-10-29; aqui o DROP FUNCTION é só para banco novo.

DROP TRIGGER IF EXISTS trg_refresh_slots ON assignments;
DROP TRIGGER IF EXISTS trg_refresh_slots_rules ON slot_rules;
DROP MATERIALIZED VIEW IF EXISTS available_slots;
DROP FUNCTION IF EXISTS refresh_available_slots();

CREATE OR REPLACE VIEW turnos_livres AS
WITH dias AS (
  SELECT d::date AS data,
         (ARRAY['SUN','MON','TUE','WED','THU','FRI','SAT'])[EXTRACT(DOW FROM d)::int + 1] AS dow
  FROM generate_series(current_date, current_date + 44, interval '1 day') d
),
grade AS (
  SELECT dias.data, sr.base_id, sr.period, sr.faculty_id,
         COALESCE(SUM(sr.capacity) FILTER (WHERE NOT sr.is_blocked), 0)::int AS capacidade,
         BOOL_OR(sr.is_blocked) AS bloqueada
  FROM dias
  JOIN slot_rules sr ON sr.day_of_week::text = dias.dow AND sr.is_active AND NOT sr.is_extra_shift
  GROUP BY 1, 2, 3, 4
),
ofertas AS (
  SELECT o.date AS data, o.base_id, o.period,
         COALESCE(o.released_faculty_id, o.faculty_id) AS faculty_id,
         COUNT(*) FILTER (WHERE o.released_faculty_id IS NOT NULL AND o.claimed_by IS NULL AND o.reserved_by IS NULL)::int AS liberadas_abertas,
         COUNT(*) FILTER (WHERE o.released_faculty_id IS NOT NULL AND o.claimed_by IS NOT NULL)::int AS liberadas_usadas,
         COUNT(*) FILTER (WHERE o.reserved_by IS NOT NULL AND o.claimed_by IS NULL)::int AS reservadas,
         COUNT(*) FILTER (WHERE o.released_faculty_id IS NULL AND o.auto_release = 'SEM_DONO' AND o.claimed_by IS NULL AND o.reserved_by IS NULL)::int AS sem_dono_abertas
  FROM extra_shift_offers o
  WHERE o.cancelled_at IS NULL AND o.date BETWEEN current_date AND current_date + 44
  GROUP BY 1, 2, 3, 4
),
de_vaga_livre AS (
  SELECT o.assignment_id
  FROM extra_shift_offers o
  WHERE o.assignment_id IS NOT NULL
    AND (o.released_faculty_id IS NOT NULL OR o.auto_release = 'SEM_DONO')
    AND o.date >= current_date
),
plantoes AS (
  SELECT a.date AS data, a.base_id, a.period, a.faculty_id, COUNT(*)::int AS n
  FROM assignments a
  WHERE a.date BETWEEN current_date AND current_date + 44
    AND a.status NOT IN ('CANCELLED', 'ABSENT')
    AND NOT a.is_extra_shift
    AND NOT EXISTS (SELECT 1 FROM de_vaga_livre v WHERE v.assignment_id = a.id)
  GROUP BY 1, 2, 3, 4
)
SELECT g.data,
       EXTRACT(DOW FROM g.data)::int AS dia_semana,
       g.base_id, b.code AS base_code, b.type AS tipo, g.period AS periodo,
       g.faculty_id, f.abbreviation AS faculdade,
       g.capacidade, g.bloqueada,
       COALESCE(p.n, 0) AS ocupadas,
       COALESCE(o.liberadas_abertas, 0) AS liberadas_abertas,
       COALESCE(o.liberadas_usadas, 0) AS liberadas_usadas,
       COALESCE(o.reservadas, 0) AS reservadas,
       0 AS sem_dono_abertas,
       GREATEST(g.capacidade - COALESCE(p.n, 0) - COALESCE(o.liberadas_abertas, 0) - COALESCE(o.liberadas_usadas, 0) - COALESCE(o.reservadas, 0), 0) AS sobra
FROM grade g
JOIN bases b ON b.id = g.base_id AND b.is_active
JOIN faculties f ON f.id = g.faculty_id
LEFT JOIN plantoes p ON p.data = g.data AND p.base_id = g.base_id AND p.period = g.period AND p.faculty_id = g.faculty_id
LEFT JOIN ofertas o ON o.data = g.data AND o.base_id = g.base_id AND o.period = g.period AND o.faculty_id = g.faculty_id
UNION ALL
SELECT o.data, EXTRACT(DOW FROM o.data)::int, o.base_id, b.code, b.type, o.period,
       NULL, NULL, 0, false, 0, 0, 0, 0, o.sem_dono_abertas, 0
FROM ofertas o
JOIN bases b ON b.id = o.base_id
WHERE o.faculty_id IS NULL AND o.sem_dono_abertas > 0;

COMMENT ON VIEW turnos_livres IS 'Turno livre por data (45 dias): grade, ocupadas, liberadas, reservadas, sem dono e sobra. Ver scripts/view-turnos-livres.sql.';
