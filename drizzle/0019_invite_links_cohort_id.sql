ALTER TABLE invite_links ADD COLUMN cohort_id uuid REFERENCES cohorts(id);
