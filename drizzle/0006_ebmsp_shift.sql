-- EBMSP shift support: add shift column to assignments
-- Allows EBMSP interns to have MORNING (07:00-13:00) and AFTERNOON (13:00-19:00) shifts
-- Other faculties continue using shift=NULL (full-day behavior)

ALTER TABLE assignments ADD COLUMN shift VARCHAR(10);

ALTER TABLE assignments ADD CONSTRAINT chk_assignment_shift
  CHECK (shift IS NULL OR shift IN ('MORNING', 'AFTERNOON'));

-- Replace old unique index to include shift (COALESCE handles NULL as 'FULL')
DROP INDEX IF EXISTS uq_intern_day_period;

CREATE UNIQUE INDEX uq_intern_day_period_shift
  ON assignments (intern_id, date, period, COALESCE(shift, 'FULL'));
