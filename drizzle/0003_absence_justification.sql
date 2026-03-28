ALTER TABLE assignments
ADD COLUMN absence_justification text,
ADD COLUMN absence_justification_actor varchar(20),
ADD COLUMN absence_justification_at timestamp;