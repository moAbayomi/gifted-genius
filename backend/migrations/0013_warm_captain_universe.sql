CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_school_code_uq" UNIQUE("school_id","code"),
	CONSTRAINT "subjects_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "subjects_code_chk" CHECK (length(trim("subjects"."code")) > 0),
	CONSTRAINT "subjects_name_chk" CHECK (length(trim("subjects"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "elective_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"min_choices" smallint NOT NULL,
	"max_choices" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elective_groups_class_name_uq" UNIQUE("class_id","name"),
	CONSTRAINT "elective_groups_id_class_uq" UNIQUE("id","class_id"),
	CONSTRAINT "elective_groups_min_choices_chk" CHECK ("elective_groups"."min_choices" >= 0),
	CONSTRAINT "elective_groups_max_choices_chk" CHECK ("elective_groups"."max_choices" >= "elective_groups"."min_choices")
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"admission_number" text NOT NULL,
	"house" text,
	"admission_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profiles_school_membership_uq" UNIQUE("school_id","membership_id"),
	CONSTRAINT "student_profiles_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "student_profiles_school_admission_uq" UNIQUE("school_id","admission_number"),
	CONSTRAINT "student_profiles_admission_number_chk" CHECK (length(trim("student_profiles"."admission_number")) > 0)
);
--> statement-breakpoint
CREATE TABLE "class_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"elective_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_subjects_class_subject_uq" UNIQUE("class_id","subject_id"),
	CONSTRAINT "class_subjects_id_class_uq" UNIQUE("id","class_id")
);
--> statement-breakpoint
CREATE TABLE "class_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"transferred_from_enrollment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_enrollments_id_class_uq" UNIQUE("id","class_id"),
	CONSTRAINT "class_enrollments_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "class_enrollments_dates_chk" CHECK ("class_enrollments"."ended_at" IS NULL OR "class_enrollments"."ended_at" >= "class_enrollments"."started_at"),
	CONSTRAINT "class_enrollments_ended_reason_requires_end_chk" CHECK ("class_enrollments"."ended_reason" IS NULL OR "class_enrollments"."ended_at" IS NOT NULL),
	CONSTRAINT "class_enrollments_ended_reason_nonempty_chk" CHECK ("class_enrollments"."ended_reason" IS NULL OR length(trim("class_enrollments"."ended_reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "student_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"class_subject_id" uuid,
	"subject_id" uuid,
	"is_extra" boolean GENERATED ALWAYS AS (class_subject_id IS NULL) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_subjects_enrollment_offering_uq" UNIQUE("enrollment_id","class_subject_id"),
	CONSTRAINT "student_subjects_id_class_uq" UNIQUE("id","class_id"),
	CONSTRAINT "student_subjects_one_choice_chk" CHECK (num_nonnulls("student_subjects"."class_subject_id", "student_subjects"."subject_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elective_groups" ADD CONSTRAINT "elective_groups_class_school_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."classes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elective_groups" ADD CONSTRAINT "elective_groups_class_session_fk" FOREIGN KEY ("class_id","session_id") REFERENCES "public"."classes"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_membership_school_fk" FOREIGN KEY ("membership_id","school_id") REFERENCES "public"."memberships"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_class_school_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."classes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_subjects" ADD CONSTRAINT "class_subjects_elective_group_class_fk" FOREIGN KEY ("elective_group_id","class_id") REFERENCES "public"."elective_groups"("id","class_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_session_fk" FOREIGN KEY ("class_id","session_id") REFERENCES "public"."classes"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_class_school_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."classes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_student_school_fk" FOREIGN KEY ("student_id","school_id") REFERENCES "public"."student_profiles"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_transferred_from_fk" FOREIGN KEY ("transferred_from_enrollment_id","school_id") REFERENCES "public"."class_enrollments"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_enrollment_class_fk" FOREIGN KEY ("enrollment_id","class_id") REFERENCES "public"."class_enrollments"("id","class_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_offering_class_fk" FOREIGN KEY ("class_subject_id","class_id") REFERENCES "public"."class_subjects"("id","class_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_subject_school_fk" FOREIGN KEY ("subject_id","school_id") REFERENCES "public"."subjects"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_class_session_fk" FOREIGN KEY ("class_id","session_id") REFERENCES "public"."classes"("id","session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_class_school_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."classes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_subjects_subject_school_idx" ON "class_subjects" USING btree ("subject_id","school_id");--> statement-breakpoint
CREATE INDEX "class_subjects_elective_group_class_idx" ON "class_subjects" USING btree ("elective_group_id","class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_enrollments_one_active_session_uq" ON "class_enrollments" USING btree ("student_id","session_id") WHERE "class_enrollments"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "class_enrollments_class_session_idx" ON "class_enrollments" USING btree ("class_id","session_id");--> statement-breakpoint
CREATE INDEX "class_enrollments_student_school_idx" ON "class_enrollments" USING btree ("student_id","school_id");--> statement-breakpoint
CREATE INDEX "class_enrollments_transferred_from_idx" ON "class_enrollments" USING btree ("transferred_from_enrollment_id","school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_subjects_enrollment_subject_extra_uq" ON "student_subjects" USING btree ("enrollment_id","subject_id") WHERE "student_subjects"."subject_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "student_subjects_enrollment_class_idx" ON "student_subjects" USING btree ("enrollment_id","class_id");--> statement-breakpoint
CREATE INDEX "student_subjects_offering_class_idx" ON "student_subjects" USING btree ("class_subject_id","class_id");--> statement-breakpoint
CREATE INDEX "student_subjects_subject_school_idx" ON "student_subjects" USING btree ("subject_id","school_id");--> statement-breakpoint
CREATE INDEX "student_subjects_class_session_idx" ON "student_subjects" USING btree ("class_id","session_id");