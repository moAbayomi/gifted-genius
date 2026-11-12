-- Custom SQL migration file, put your code below! --

-- Backfill the 6 default levels for any school that doesn't have levels yet.
-- Idempotent: the NOT EXISTS guard means re-running does nothing for schools
-- that already have at least one level (so partial state won't be corrupted).
--
-- The list here matches DEFAULT_LEVELS in db/schema/default-levels.ts at the
-- time of this migration. If you change DEFAULT_LEVELS later, new schools get
-- the new list; existing schools keep this frozen list. That's correct — you
-- don't retroactively rename "JSS 1" for a school that's been running for a
-- year.
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
WHERE NOT EXISTS (
  SELECT 1 FROM levels WHERE levels.school_id = s.id
);