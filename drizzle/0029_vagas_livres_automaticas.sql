-- Migration 0029: liberação automática de vagas
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Fica aqui como
-- registro do que mudou. Ver auto-release-slots.ts.

ALTER TABLE "extra_shift_offers"
  ADD COLUMN IF NOT EXISTS "auto_release" varchar(10);

CREATE TABLE IF NOT EXISTS "vacancy_release_settings" (
  "faculty_id" uuid PRIMARY KEY REFERENCES "faculties"("id"),
  "enabled" boolean NOT NULL DEFAULT true,
  "deadline_days" integer NOT NULL DEFAULT 3,
  "enabled_since" date NOT NULL DEFAULT now(),
  "updated_by" uuid REFERENCES "users"("id"),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
