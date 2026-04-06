ALTER TABLE "user_roles" ADD COLUMN "is_archived" boolean NOT NULL DEFAULT false;
ALTER TABLE "user_roles" ADD COLUMN "archived_at" timestamp;
ALTER TABLE "user_roles" ADD COLUMN "archived_by" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'user_roles_archived_by_users_id_fk'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_archived_by_users_id_fk"
      FOREIGN KEY ("archived_by") REFERENCES "users"("id");
  END IF;
END $$;
