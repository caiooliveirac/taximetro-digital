ALTER TABLE users
ADD COLUMN merged_into_user_id uuid REFERENCES users(id),
ADD COLUMN merged_at timestamp,
ADD COLUMN merge_rollback_expires_at timestamp;

CREATE TABLE user_merge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_user_id uuid NOT NULL REFERENCES users(id),
  source_name varchar(255) NOT NULL,
  source_email varchar(255) NOT NULL,
  target_user_id uuid NOT NULL REFERENCES users(id),
  target_name varchar(255) NOT NULL,
  target_email varchar(255) NOT NULL,
  performed_by_user_id uuid NOT NULL REFERENCES users(id),
  source_user_snapshot jsonb NOT NULL,
  source_roles_snapshot jsonb NOT NULL,
  source_binding_snapshot jsonb,
  moved_records jsonb NOT NULL,
  inserted_target_role_ids jsonb NOT NULL,
  rollback_available_until timestamp NOT NULL,
  rolled_back_at timestamp,
  rolled_back_by_user_id uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_merge_events_source ON user_merge_events(source_user_id);
CREATE INDEX idx_user_merge_events_target ON user_merge_events(target_user_id);
CREATE INDEX idx_user_merge_events_available_until ON user_merge_events(rollback_available_until);