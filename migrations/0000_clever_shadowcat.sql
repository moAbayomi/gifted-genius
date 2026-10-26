CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"middle_name" text,
	"phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_chk" CHECK ("users"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_name" text,
	"type" text DEFAULT 'combined' NOT NULL,
	"motto" text,
	"address" text,
	"city" text,
	"state" text,
	"contact_email" text,
	"contact_phone" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schools_slug_chk" CHECK ("schools"."slug" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "schools_status_chk" CHECK ("schools"."status" in ('active', 'suspended')),
	CONSTRAINT "schools_type_chk" CHECK ("schools"."type" in ('junior', 'senior', 'combined'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"rank" smallint NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "roles_rank_chk" CHECK ("roles"."rank" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"username" text,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_id_school_uq" UNIQUE("id","school_id"),
	CONSTRAINT "memberships_id_user_uq" UNIQUE("id","user_id"),
	CONSTRAINT "memberships_username_chk" CHECK ("memberships"."username" is null or "memberships"."username" = lower("memberships"."username")),
	CONSTRAINT "memberships_status_chk" CHECK ("memberships"."status" in ('active', 'inactive', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_membership_id_role_id_pk" PRIMARY KEY("membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"active_membership_id" uuid NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_actor_needs_school_chk" CHECK ("audit_log"."actor_membership_id" is null or "audit_log"."school_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_school_fk" FOREIGN KEY ("membership_id","school_id") REFERENCES "public"."memberships"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_school_fk" FOREIGN KEY ("role_id","school_id") REFERENCES "public"."roles"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_assigned_by_school_fk" FOREIGN KEY ("assigned_by","school_id") REFERENCES "public"."memberships"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_user_fk" FOREIGN KEY ("active_membership_id","user_id") REFERENCES "public"."memberships"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_actor_school_fk" FOREIGN KEY ("actor_membership_id","school_id") REFERENCES "public"."memberships"("id","school_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_slug_uq" ON "schools" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_school_key_uq" ON "roles" USING btree ("school_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_school_user_uq" ON "memberships" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_school_username_uq" ON "memberships" USING btree ("school_id","username");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_school_status_idx" ON "memberships" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "membership_roles_school_role_idx" ON "membership_roles" USING btree ("school_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_school_time_idx" ON "audit_log" USING btree ("school_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_target_time_idx" ON "audit_log" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);