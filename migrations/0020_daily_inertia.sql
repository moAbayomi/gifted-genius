ALTER TABLE "student_subjects" DROP CONSTRAINT "student_subjects_one_choice_chk";--> statement-breakpoint
ALTER TABLE "student_subjects" DROP CONSTRAINT "student_subjects_subject_school_fk";
--> statement-breakpoint
DROP INDEX "student_subjects_enrollment_subject_extra_uq";--> statement-breakpoint
DROP INDEX "student_subjects_subject_school_idx";--> statement-breakpoint
ALTER TABLE "student_subjects" ALTER COLUMN "class_subject_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "student_subjects" DROP COLUMN "subject_id";--> statement-breakpoint
ALTER TABLE "student_subjects" DROP COLUMN "is_extra";