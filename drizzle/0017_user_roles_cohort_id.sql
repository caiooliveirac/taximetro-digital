ALTER TABLE user_roles ADD COLUMN cohort_id uuid REFERENCES cohorts(id);
CREATE INDEX idx_user_roles_cohort ON user_roles(cohort_id);
