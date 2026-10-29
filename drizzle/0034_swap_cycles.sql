-- Migration 0034: troca a três (roda) — swap_cycles e swap_cycle_legs
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.
-- Ver src/shared/domain/policies/swap-cycle-policy.ts.

DO $$ BEGIN
  CREATE TYPE "swap_cycle_status" AS ENUM ('PROPOSTA', 'CONCLUIDA', 'RECUSADA', 'CANCELADA', 'EXPIRADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "swap_cycles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" "swap_cycle_status" DEFAULT 'PROPOSTA' NOT NULL,
  "proposed_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "closed_at" timestamp,
  "closed_reason" text
);
CREATE INDEX IF NOT EXISTS "idx_swap_cycle_status" ON "swap_cycles" ("status");

CREATE TABLE IF NOT EXISTS "swap_cycle_legs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cycle_id" uuid NOT NULL REFERENCES "swap_cycles"("id"),
  "intern_id" uuid NOT NULL REFERENCES "users"("id"),
  "gives_assignment_id" uuid NOT NULL REFERENCES "assignments"("id"),
  "receives_assignment_id" uuid NOT NULL REFERENCES "assignments"("id"),
  "position" integer NOT NULL,
  "confirmed_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_swap_cycle_leg_intern" ON "swap_cycle_legs" ("cycle_id", "intern_id");
CREATE INDEX IF NOT EXISTS "idx_swap_cycle_leg_intern" ON "swap_cycle_legs" ("intern_id");
CREATE INDEX IF NOT EXISTS "idx_swap_cycle_leg_gives" ON "swap_cycle_legs" ("gives_assignment_id");
