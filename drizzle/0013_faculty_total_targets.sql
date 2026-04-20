-- Add total targets by base type for more accurate historical debt tracking
ALTER TABLE "faculties"
ADD COLUMN "target_usas_total" integer NOT NULL DEFAULT 0,
ADD COLUMN "target_crus_total" integer NOT NULL DEFAULT 0;

-- Backfill using a 5-week baseline from weekly targets (editable in admin)
UPDATE "faculties"
SET
  "target_usas_total" = CASE
    WHEN "target_usas_per_week" > 0 THEN GREATEST(5 * "target_usas_per_week", "target_usas_per_week")
    ELSE 0
  END,
  "target_crus_total" = CASE
    WHEN "target_crus_per_week" > 0 THEN GREATEST(5 * "target_crus_per_week", "target_crus_per_week")
    ELSE 0
  END;
