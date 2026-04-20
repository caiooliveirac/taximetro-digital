-- Split shift targets by base type (USA/CRU/CRL)
-- This migration adds three new columns to faculties table to replace the ambiguous targetShiftsPerWeek

ALTER TABLE "faculties" 
ADD COLUMN "target_usas_per_week" integer NOT NULL DEFAULT 0,
ADD COLUMN "target_crus_per_week" integer NOT NULL DEFAULT 0,
ADD COLUMN "target_crls_per_week" integer NOT NULL DEFAULT 0;

-- Backfill data: if targetShiftsPerWeek was set, distribute equally across types
-- For now, set all to 0 and will be updated via admin for each faculty
UPDATE "faculties" 
SET 
  "target_usas_per_week" = 0,
  "target_crus_per_week" = 0,
  "target_crls_per_week" = 0
WHERE "target_shifts_per_week" > 0;

-- Keep the old column for now (soft migration), will be deprecated in UI layer
