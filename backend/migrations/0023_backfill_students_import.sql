-- Grant the new class-scoped import capability to the seeded roles at every
-- existing school. Without this, a teacher at an existing tenant would be
-- refused even though fresh schools get the grant from DEFAULT_ROLES.
--
-- New permission keys are never auto-granted by code; a migration must do it.
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, 'students:import'
FROM roles r
WHERE r.key IN ('owner', 'principal', 'teacher')
ON CONFLICT DO NOTHING;
