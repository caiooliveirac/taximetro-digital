-- Migration 0037: liberações da agenda acadêmica — commitment_releases.
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.

DO $$ BEGIN
  CREATE TYPE "release_resolution" AS ENUM ('PENDENTE', 'ABONADO', 'REPOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "commitment_releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "commitment_id" uuid NOT NULL REFERENCES "cohort_commitments"("id"),
  "assignment_id" uuid NOT NULL REFERENCES "assignments"("id"),
  "intern_id" uuid NOT NULL REFERENCES "users"("id"),
  "faculty_id" uuid NOT NULL REFERENCES "faculties"("id"),
  "date" date NOT NULL,
  "period" "shift_period" NOT NULL,
  "base_type" varchar(20) NOT NULL,
  "resolution" "release_resolution" DEFAULT 'PENDENTE' NOT NULL,
  "resolved_by" uuid REFERENCES "users"("id"),
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_release_assignment" ON "commitment_releases" ("assignment_id");
CREATE INDEX IF NOT EXISTS "idx_release_faculty" ON "commitment_releases" ("faculty_id", "resolution");
CREATE INDEX IF NOT EXISTS "idx_release_intern" ON "commitment_releases" ("intern_id");
