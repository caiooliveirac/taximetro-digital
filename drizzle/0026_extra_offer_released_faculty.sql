-- Migration 0026: vaga liberada pela faculdade
-- Uma oferta de plantão extra com released_faculty_id preenchido é uma vaga da
-- grade fixa daquela faculdade que ela abriu mão numa data/turno. Enquanto não
-- for cancelada, o sorteio e a grade da faculdade descontam a vaga.

ALTER TABLE "extra_shift_offers"
  ADD COLUMN IF NOT EXISTS "released_faculty_id" uuid REFERENCES "faculties"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_extra_offer_released"
  ON "extra_shift_offers" ("released_faculty_id", "date");
