-- Custom SQL migration file, put your code below! --
-- Grant the seven Phase 2 academics permissions to existing schools' system
-- roles. New schools already get them via createSchoolWithDefaults, but
-- schools created before these permissions were added to DEFAULT_ROLES only
-- have the original 11 permissions. Without this migration, an existing
-- owner/principal/teacher gets 403 on the first calendar read/write route
-- that checks academics:read, calendar:manage, or structure:manage.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running (or running against a
-- database where some rows already exist) is safe. This is the safety net
-- for a partial-application scenario.
--
-- Custom roles are excluded by design: `is_system = true` restricts to the
-- five roles seeded at school creation. If a school creates a custom
-- "Vice Principal" role later, an admin must grant it these permissions
-- explicitly — the migration does not guess that custom roles should be
-- staff-equivalent.
--
-- The owner role is NOT skipped despite being "locked." Locked means
-- "these rows can never be edited after this" (a service-layer rule). The
-- rows themselves must exist. Missing grants = broken owner.

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, np.permission
FROM roles r
CROSS JOIN (VALUES
  ('academics:read'),
  ('calendar:manage'),
  ('structure:manage'),
  ('enrollments:read'),
  ('enrollments:read_all'),
  ('enrollments:manage'),
  ('assignments:manage')
) AS np(permission)
WHERE r.is_system = true
  AND (
    -- Owner and principal get all seven
    r.key IN ('owner', 'principal')
    -- Teacher gets only the two scoped ones
    OR (r.key = 'teacher' AND np.permission IN ('academics:read', 'enrollments:read'))
  )
ON CONFLICT (role_id, permission) DO NOTHING;