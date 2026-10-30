-- Migration 0036: agenda acadêmica da turma — cohort_commitments e
-- extra_shift_offers.commitment_id. Aplicada pelo `drizzle-kit push` do deploy
-- (apply_db_changes). Registro. Ver academic-commitment-policy.ts.

DO $$ BEGIN
  CREATE TYPE "commitment_kind" AS ENUM ('PROVA', 'ATIVIDADE', 'AULA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "cohort_commitments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cohort_id" uuid NOT NULL REFERENCES "cohorts"("id"),
  "faculty_id" uuid NOT NULL REFERENCES "faculties"("id"),
  "kind" "commitment_kind" NOT NULL,
  "title" varchar(120) NOT NULL,
  "date" date NOT NULL,
  "blocks_day" boolean DEFAULT false NOT NULL,
  "blocks_night" boolean DEFAULT false NOT NULL,
  "blocks_eve_night" boolean DEFAULT false NOT NULL,
  "intern_ids" uuid[],
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "cancelled_at" timestamp,
  "cancelled_by" uuid REFERENCES "users"("id")
);
CREATE INDEX IF NOT EXISTS "idx_commitment_faculty_date" ON "cohort_commitments" ("faculty_id", "date");
CREATE INDEX IF NOT EXISTS "idx_commitment_cohort" ON "cohort_commitments" ("cohort_id");

ALTER TABLE "extra_shift_offers" ADD COLUMN IF NOT EXISTS "commitment_id" uuid REFERENCES "cohort_commitments"("id");
