-- Migration 0014: extra_shift_offers
-- Tabela de ofertas públicas de plantões extras (first-come-first-served)
-- Publicadas por COORDINATOR/LEADER; reivindicadas por INTERN/LEADER

CREATE TABLE IF NOT EXISTS "extra_shift_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "base_id" uuid NOT NULL REFERENCES "bases"("id"),
  "date" date NOT NULL,
  "period" "shift_period" NOT NULL,
  "shift" varchar(15),
  "faculty_id" uuid REFERENCES "faculties"("id"),
  "notes" text,
  "published_by" uuid NOT NULL REFERENCES "users"("id"),
  "published_at" timestamp DEFAULT now() NOT NULL,
  "claimed_by" uuid REFERENCES "users"("id"),
  "claimed_at" timestamp,
  "assignment_id" uuid REFERENCES "assignments"("id"),
  "cancelled_at" timestamp,
  "cancelled_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_extra_offer_date" ON "extra_shift_offers" ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_extra_offer_base" ON "extra_shift_offers" ("base_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_extra_offer_claimed_by" ON "extra_shift_offers" ("claimed_by");
