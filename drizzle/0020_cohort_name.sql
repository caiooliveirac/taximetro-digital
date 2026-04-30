-- Adiciona campo `name` (apelido curto definido pelo coordenador) à tabela cohorts.
-- Nullable inicialmente para não quebrar rows existentes; backfill abaixo.
ALTER TABLE cohorts ADD COLUMN name varchar(100);

-- Backfill: extrair parte antes do " (" do label atual como name provisório.
UPDATE cohorts SET name = split_part(label, ' (', 1) WHERE name IS NULL;

-- Índice único por faculdade + name para evitar duplicatas.
CREATE UNIQUE INDEX uq_cohort_faculty_name ON cohorts(faculty_id, name);
