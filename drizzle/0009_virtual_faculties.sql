-- Pseudo-faculdades para reservar vagas na grade sem internos cadastrados
ALTER TABLE faculties ADD COLUMN is_virtual boolean NOT NULL DEFAULT false;

INSERT INTO faculties (name, abbreviation, target_hours, target_shifts, target_shifts_per_week, total_interns, is_virtual)
VALUES
  ('Pós-Graduação', 'PÓS', 0, 0, 0, 0, true),
  ('Residência Médica', 'RESI', 0, 0, 0, 0, true);
