-- Custom SQL migration file, put your code below! --
-- Backfill the 6 default levels for any school missing them.
-- Per-level idempotent: on a school with 0 levels, inserts 6;
-- on a school with all 6, no-op; on a school with 3, inserts the missing 3.
--
-- Replaces the 0006 backfill, which used a per-school NOT EXISTS guard
-- and skipped any school that had even one level — leaving partial states
-- unfixed. See ADR 0014 for the reasoning.
--
-- ON CONFLICT DO NOTHING (no target) is deliberate: levels has two unique
-- constraints, (school_id, name) and (school_id, sequence). Targeting only
-- the name would still abort on a custom level whose sequence collides with
-- a default level (e.g. a "Primary 1" at sequence 1).
INSERT INTO levels (school_id, name, sequence, stage)
SELECT s.id, l.name, l.sequence, l.stage
FROM schools s
CROSS JOIN (VALUES
  ('JSS 1', 1::smallint, 'junior'),
  ('JSS 2', 2::smallint, 'junior'),
  ('JSS 3', 3::smallint, 'junior'),
  ('SS 1',  4::smallint, 'senior'),
  ('SS 2',  5::smallint, 'senior'),
  ('SS 3',  6::smallint, 'senior')
) AS l(name, sequence, stage)
ON CONFLICT DO NOTHING;