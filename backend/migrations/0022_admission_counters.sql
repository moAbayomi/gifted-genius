CREATE TABLE "admission_counters" (
	"school_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "admission_counters_school_id_year_pk" PRIMARY KEY("school_id","year")
);
--> statement-breakpoint
ALTER TABLE "admission_counters" ADD CONSTRAINT "admission_counters_school_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;