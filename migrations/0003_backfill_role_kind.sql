-- Custom SQL migration file, put your code below! --

-- Backfill roles.kind for the two non-staff system roles.
-- The migration above set every existing role to kind='staff' (the column
-- default). Only student and guardian are NOT staff. Fix them.
--
-- The `is_system = true` guard is deliberate: it ensures this migration only
-- touches the 5 system roles that exist at this point, never any custom
-- role a school may have created later. If someone re-runs this migration
-- (rare, but possible in a restore scenario), custom roles stay untouched —
-- a custom "Student Helper" role would not be silently flipped to
-- kind='student' just because its key contains the word "student".

UPDATE roles
SET kind = 'student'
WHERE key = 'student' AND is_system = true;

UPDATE roles
SET kind = 'guardian'
WHERE key = 'guardian' AND is_system = true;