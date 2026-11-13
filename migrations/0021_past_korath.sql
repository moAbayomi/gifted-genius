CREATE TABLE "subject_teacher_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"class_subject_id" uuid NOT NULL,
	"teacher_membership_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "form_teacher_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "subject_teacher_assignments" ADD CONSTRAINT "subject_teacher_assignments_class_subject_class_fk" FOREIGN KEY ("class_subject_id","class_id") REFERENCES "public"."class_subjects"("id","class_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_teacher_assignments" ADD CONSTRAINT "subject_teacher_assignments_class_school_fk" FOREIGN KEY ("class_id","school_id") REFERENCES "public"."classes"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_teacher_assignments" ADD CONSTRAINT "subject_teacher_assignments_teacher_membership_school_fk" FOREIGN KEY ("teacher_membership_id","school_id") REFERENCES "public"."memberships"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subject_teacher_assignments_active_uq" ON "subject_teacher_assignments" USING btree ("class_subject_id","teacher_membership_id") WHERE "subject_teacher_assignments"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "subject_teacher_assignments_teacher_school_idx" ON "subject_teacher_assignments" USING btree ("teacher_membership_id","school_id");--> statement-breakpoint
CREATE INDEX "subject_teacher_assignments_class_school_idx" ON "subject_teacher_assignments" USING btree ("class_id","school_id");--> statement-breakpoint
CREATE INDEX "subject_teacher_assignments_class_subject_class_idx" ON "subject_teacher_assignments" USING btree ("class_subject_id","class_id");--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_form_teacher_membership_school_fk" FOREIGN KEY ("form_teacher_membership_id","school_id") REFERENCES "public"."memberships"("id","school_id") ON DELETE no action ON UPDATE no action;