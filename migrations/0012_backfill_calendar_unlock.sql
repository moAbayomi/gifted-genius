-- Grant the new owner-only `calendar:unlock` permission to existing system
-- owner roles. New schools get it through DEFAULT_ROLES (owner has the full
-- catalogue), but existing owner roles keep the permissions they were created
-- with. Principals intentionally do not receive it.
--
-- Idempotent: ON CONFLICT DO NOTHING.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'calendar:unlock'
FROM roles r
WHERE r.is_system = true
  AND r.key = 'owner'
ON CONFLICT (role_id, permission) DO NOTHING;
