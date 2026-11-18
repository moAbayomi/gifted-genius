-- Add the lifecycle column without a NOT NULL/default/check yet.
-- Existing ended rows are backfilled by 0019 before the constraint is added,
-- so this migration is safe on a database that already has history.
ALTER TABLE "class_enrollments" ADD COLUMN "status" text;
