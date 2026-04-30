CREATE TYPE cohort_status AS ENUM ('PLANNED','ACTIVE','CLOSED');

CREATE TABLE cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faculty_id uuid NOT NULL REFERENCES faculties(id),
  rotation_number integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  label varchar(255) NOT NULL,
  status cohort_status NOT NULL DEFAULT 'PLANNED',
  closed_at timestamp,
  closed_by uuid REFERENCES users(id),
  closing_report_snapshot jsonb,
  closing_report_html text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_cohort_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_cohort_closed_consistency CHECK (
    (status = 'CLOSED' AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
    OR status <> 'CLOSED'
  )
);

CREATE UNIQUE INDEX uq_cohort_faculty_rotation ON cohorts(faculty_id, rotation_number);
CREATE INDEX idx_cohort_faculty_status ON cohorts(faculty_id, status);
CREATE INDEX idx_cohort_dates ON cohorts(start_date, end_date);
