CREATE TABLE "levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sequence" smallint NOT NULL,
	"stage" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "levels_school_name_uq" UNIQUE("school_id","name"),
	CONSTRAINT "levels_school_sequence_uq" UNIQUE("school_id","sequence"),
	CONSTRAINT "levels_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "levels_sequence_chk" CHECK ("levels"."sequence" >= 1),
	CONSTRAINT "levels_stage_chk" CHECK ("levels"."stage" in ('junior', 'senior'))
);
--> statement-breakpoint
ALTER TABLE "levels" ADD CONSTRAINT "levels_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;