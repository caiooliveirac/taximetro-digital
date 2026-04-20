-- Add rotation_start_date to faculties table
-- This date marks when the rotation cycle starts for compliance calculations
-- Interns created before this date should not be counted as having deficit for that faculty

ALTER TABLE "faculties"
ADD COLUMN "rotation_start_date" date DEFAULT CURRENT_DATE;

-- For existing faculties, default to today (can be adjusted per faculty via admin UI)
-- Zarns can set this to 2026-04-20, UNIFACS can be set to an earlier date if needed
UPDATE "faculties"
SET "rotation_start_date" = CURRENT_DATE
WHERE "rotation_start_date" IS NULL;

-- Make the column NOT NULL
ALTER TABLE "faculties"
ALTER COLUMN "rotation_start_date" SET NOT NULL;
