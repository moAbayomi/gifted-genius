CREATE TABLE "academic_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"label" text NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_sessions_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "academic_sessions_label_chk" CHECK ("academic_sessions"."label" ~ '^[0-9]{4}/[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_session_number_uq" UNIQUE("session_id","number"),
	CONSTRAINT "terms_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "terms_id_session_uq" UNIQUE("id","session_id"),
	CONSTRAINT "terms_dates_chk" CHECK ("terms"."end_date" >= "terms"."start_date"),
	CONSTRAINT "terms_number_chk" CHECK ("terms"."number" >= 1),
	CONSTRAINT "terms_status_chk" CHECK ("terms"."status" in ('planned', 'active', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_session_school_fk" FOREIGN KEY ("session_id","school_id") REFERENCES "public"."academic_sessions"("id","school_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_sessions_school_label_uq" ON "academic_sessions" USING btree ("school_id","label");--> statement-breakpoint
CREATE INDEX "terms_school_status_idx" ON "terms" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "terms_one_active_per_school" ON "terms" USING btree ("school_id") WHERE "terms"."status" = 'active';