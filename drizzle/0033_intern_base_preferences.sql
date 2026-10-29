-- Migration 0033: bases preferidas do interno (ordenam o mercado de trocas)
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.
-- Ver src/shared/domain/policies/swap-match-policy.ts.

CREATE TABLE IF NOT EXISTS "intern_base_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intern_id" uuid NOT NULL REFERENCES "users"("id"),
  "base_id" uuid NOT NULL REFERENCES "bases"("id"),
  "weight" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_base_pref_intern_base" ON "intern_base_preferences" ("intern_id", "base_id");
