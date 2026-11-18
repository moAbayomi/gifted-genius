-- 1. Ensure the column has a default (safe even if it already does).
ALTER TABLE "class_enrollments" ALTER COLUMN "status" SET DEFAULT 'active';
--> statement-breakpoint

-- 2. Backfill any NULL statuses based on ended_at/ended_reason.
--    On a fresh DB with no rows, this is a no-op.
--    On a DB with rows, it fills them before NOT NULL fires.
UPDATE "class_enrollments"
SET "status" = CASE
  WHEN "ended_at" IS NOT NULL AND "ended_reason" = 'transferred' THEN 'transferred'
  WHEN "ended_at" IS NOT NULL THEN 'withdrawn'
  ELSE 'active'
END
WHERE "status" IS NULL;
--> statement-breakpoint

-- 3. Enforce NOT NULL now that no rows are null.
ALTER TABLE "class_enrollments" ALTER COLUMN "status" SET NOT NULL;
--> statement-breakpoint

-- 4. Add the check constraint. Wrap in a DO block if it might already exist.
DO $$ BEGIN
  ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_status_ended_chk"
    CHECK (
      "status" IN ('active', 'transferred', 'withdrawn')
      AND (
        ("status" = 'active' AND "ended_at" IS NULL)
        OR
        ("status" <> 'active' AND "ended_at" IS NOT NULL)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;