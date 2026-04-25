ALTER TYPE "public"."base_type" ADD VALUE 'CRL';--> statement-breakpoint
ALTER TYPE "public"."request_status" ADD VALUE 'OPEN';--> statement-breakpoint
ALTER TYPE "public"."request_status" ADD VALUE 'CANCELLED';--> statement-breakpoint
CREATE TABLE "cru_fixed_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intern_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"period" "shift_period" NOT NULL,
	"created_by" uuid NOT NULL,
	"valid_until" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rotation_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faculty_id" uuid NOT NULL,
	"rotation_number" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"label" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_merge_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_user_id" uuid NOT NULL,
	"source_name" varchar(255) NOT NULL,
	"source_email" varchar(255) NOT NULL,
	"target_user_id" uuid NOT NULL,
	"target_name" varchar(255) NOT NULL,
	"target_email" varchar(255) NOT NULL,
	"performed_by_user_id" uuid NOT NULL,
	"source_user_snapshot" jsonb NOT NULL,
	"source_roles_snapshot" jsonb NOT NULL,
	"source_binding_snapshot" jsonb,
	"moved_records" jsonb NOT NULL,
	"inserted_target_role_ids" jsonb NOT NULL,
	"rollback_available_until" timestamp NOT NULL,
	"rolled_back_at" timestamp,
	"rolled_back_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "uq_intern_day_period";--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "shift" varchar(10);--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "is_extra_shift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "extra_shift_notes" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "absence_justification" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "absence_justification_actor" varchar(20);--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "absence_justification_at" timestamp;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "intern_observations" text;--> statement-breakpoint
ALTER TABLE "checkins" ADD COLUMN "preceptor_observations" text;--> statement-breakpoint
ALTER TABLE "faculties" ADD COLUMN "target_usas_per_week" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "faculties" ADD COLUMN "target_usas_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "faculties" ADD COLUMN "target_crus_per_week" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "faculties" ADD COLUMN "target_crus_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "faculties" ADD COLUMN "target_crls_per_week" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "faculties" ADD COLUMN "is_virtual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "faculties" ADD COLUMN "rotation_start_date" date DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_links" ADD COLUMN "target_role" varchar(20) DEFAULT 'INTERN' NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_links" ADD COLUMN "base_id" uuid;--> statement-breakpoint
ALTER TABLE "slot_rules" ADD COLUMN "is_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "slot_rules" ADD COLUMN "blocked_reason" varchar(100);--> statement-breakpoint
ALTER TABLE "slot_rules" ADD COLUMN "blocked_by" uuid;--> statement-breakpoint
ALTER TABLE "slot_rules" ADD COLUMN "blocked_at" timestamp;--> statement-breakpoint
ALTER TABLE "slot_rules" ADD COLUMN "is_extra_shift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "force_password_change" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "merged_into_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "merged_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "merge_rollback_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "cru_fixed_assignments" ADD CONSTRAINT "cru_fixed_assignments_intern_id_users_id_fk" FOREIGN KEY ("intern_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cru_fixed_assignments" ADD CONSTRAINT "cru_fixed_assignments_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cru_fixed_assignments" ADD CONSTRAINT "cru_fixed_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotation_transitions" ADD CONSTRAINT "rotation_transitions_faculty_id_faculties_id_fk" FOREIGN KEY ("faculty_id") REFERENCES "public"."faculties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merge_events" ADD CONSTRAINT "user_merge_events_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merge_events" ADD CONSTRAINT "user_merge_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merge_events" ADD CONSTRAINT "user_merge_events_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merge_events" ADD CONSTRAINT "user_merge_events_rolled_back_by_user_id_users_id_fk" FOREIGN KEY ("rolled_back_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_cru_fixed" ON "cru_fixed_assignments" USING btree ("intern_id","day_of_week","period");--> statement-breakpoint
CREATE INDEX "idx_cru_fixed_faculty" ON "cru_fixed_assignments" USING btree ("faculty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_rotation_per_faculty" ON "rotation_transitions" USING btree ("faculty_id","rotation_number");--> statement-breakpoint
CREATE INDEX "idx_rotation_faculty" ON "rotation_transitions" USING btree ("faculty_id");--> statement-breakpoint
CREATE INDEX "idx_user_merge_events_source" ON "user_merge_events" USING btree ("source_user_id");--> statement-breakpoint
CREATE INDEX "idx_user_merge_events_target" ON "user_merge_events" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "idx_user_merge_events_available_until" ON "user_merge_events" USING btree ("rollback_available_until");--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_base_id_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."bases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_rules" ADD CONSTRAINT "slot_rules_blocked_by_users_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;