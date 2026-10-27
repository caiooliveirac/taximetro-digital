-- Migration 0030: pedido de vaga livre acima da meta
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.
-- Ver claim-extra-offer.ts e review-request.ts.

ALTER TYPE "request_type" ADD VALUE IF NOT EXISTS 'FREE_SLOT';

ALTER TABLE "requests"
  ADD COLUMN IF NOT EXISTS "extra_offer_id" uuid REFERENCES "extra_shift_offers"("id");
