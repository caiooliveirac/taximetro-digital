-- Migration 0038: faculdade que segura a vaga sem check-in (pós-graduações).
-- Aplicada pelo `drizzle-kit push` do deploy (apply_db_changes). Registro.
-- Quais faculdades ligam é decisão da coordenação, na aba Faculdades.

ALTER TABLE "faculties" ADD COLUMN IF NOT EXISTS "holds_slot_without_checkin" boolean DEFAULT false NOT NULL;
