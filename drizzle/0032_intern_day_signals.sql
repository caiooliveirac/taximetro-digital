-- Migration 0032: sinais do interno no calendário (outro serviço, quero, posso)
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.
-- Ver src/shared/domain/policies/day-signal-policy.ts.

DO $$ BEGIN
  CREATE TYPE "day_signal" AS ENUM ('OUTRO_SERVICO', 'QUERO', 'POSSO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "intern_day_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intern_id" uuid NOT NULL REFERENCES "users"("id"),
  "date" date NOT NULL,
  "period" "shift_period" NOT NULL,
  "signal" "day_signal" NOT NULL,
  "label" varchar(60),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_day_signal_intern_slot" ON "intern_day_signals" ("intern_id", "date", "period");
CREATE INDEX IF NOT EXISTS "idx_day_signal_date" ON "intern_day_signals" ("date");
