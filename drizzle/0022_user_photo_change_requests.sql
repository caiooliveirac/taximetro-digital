CREATE TYPE photo_change_request_status AS ENUM('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE user_photo_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  faculty_id uuid REFERENCES faculties(id),
  current_selfie text,
  requested_selfie text NOT NULL,
  status photo_change_request_status NOT NULL DEFAULT 'PENDING',
  requested_at timestamp NOT NULL DEFAULT now(),
  reviewed_at timestamp,
  reviewed_by uuid REFERENCES users(id),
  review_notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_photo_change_user_status ON user_photo_change_requests(user_id, status);
CREATE INDEX idx_photo_change_faculty_status ON user_photo_change_requests(faculty_id, status);
CREATE INDEX idx_photo_change_requested_at ON user_photo_change_requests(requested_at);