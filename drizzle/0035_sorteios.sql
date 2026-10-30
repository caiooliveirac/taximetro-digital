-- Migration 0035: sorteio da repescagem — sorteio_inscricoes e sorteios
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.
-- Ver src/features/extra-offers/application/sorteio-repescagem.ts.

CREATE TABLE IF NOT EXISTS "sorteio_inscricoes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intern_id" uuid NOT NULL REFERENCES "users"("id"),
  "date" date NOT NULL,
  "period" "shift_period" NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sorteio_inscricao" ON "sorteio_inscricoes" ("intern_id", "date", "period");
CREATE INDEX IF NOT EXISTS "idx_sorteio_inscricao_turno" ON "sorteio_inscricoes" ("date", "period");

CREATE TABLE IF NOT EXISTS "sorteios" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "date" date NOT NULL,
  "period" "shift_period" NOT NULL,
  "ran_at" timestamp DEFAULT now() NOT NULL,
  "semente" varchar(64) NOT NULL,
  "resultado" jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sorteio_turno" ON "sorteios" ("date", "period");
