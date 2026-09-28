-- Migration 0028: vaga reservada pela coordenação
-- Oferta com released_faculty_id E reserved_by preenchidos é uma vaga da grade
-- daquela faculdade que o coordenador segurou numa data/turno. Não aparece no
-- board nem para as outras faculdades; some da escala do líder e do sorteio
-- até ser cancelada.

ALTER TABLE "extra_shift_offers"
  ADD COLUMN IF NOT EXISTS "reserved_by" uuid REFERENCES "users"("id");
