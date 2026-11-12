CREATE TABLE "classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"level_id" uuid NOT NULL,
	"arm_label" text NOT NULL,
	"track" text DEFAULT 'general' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classes_session_level_arm_track_uq" UNIQUE("session_id","level_id","arm_label","track"),
	CONSTRAINT "classes_id_session_uq" UNIQUE("id","session_id"),
	CONSTRAINT "classes_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "classes_arm_label_chk" CHECK (length(trim("classes"."arm_label")) > 0),
	CONSTRAINT "classes_track_chk" CHECK ("classes"."track" in ('general', 'science', 'arts', 'commercial'))
);
--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_level_school_fk" FOREIGN KEY ("level_id","school_id") REFERENCES "public"."levels"("id","school_id") ON DELETE restrict ON UPDATE no action;