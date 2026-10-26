
// The complete catalog of capabilities in the system.
// This file is the SOURCE OF TRUTH for what actions exist.
// The database (role_permissions) only stores *which role at which school* has
// been granted each one.
//
// ─── Convention ────────────────────────────────────────────────────────────
//   resource:action
//
//   resource:
//     - lowercase
//     - PLURAL for collections (users, roles)
//     - SINGULAR for the tenant itself (school) or a single well-known
//       object (audit — one log, not a collection)
//
//   action:
//     - lowercase
//     - snake_case if multi-word (reset_password, not reset-password)
//
// ─── Adding a permission ──────────────────────────────────────────────────
//   1. Add the string to the array below (this file).
//   2. Add it to DEFAULT_ROLES in default-roles.ts for
//      the roles that should have it by default.
//   Existing schools do NOT auto-grant a new permission. It exists in code
//   but is on no one's role_permissions until an admin enables it (or a
//   migration grants it). This is deliberate: adding a capability never
//   silently changes behavior at existing tenants.
//
// ─── Renaming a permission ────────────────────────────────────────────────
//   `role_permissions.permission` is a plain text column, NOT a foreign key.
//   A code-side rename does NOT update existing grants, and old grants become
//   silent no-ops (a permission that no route checks). Rename as a migration:
//
//     1. UPDATE role_permissions SET permission = '<new>' WHERE permission = '<old>';
//     2. Deploy code with the new name in this file.
//     3. (Optional) Clean up audit_log.metadata if it contains the old name.
//
//   Never deploy the code change before the migration runs — that's the one
//   ordering that leaves grants orphaned.
//
// ─── When to add ──────────────────────────────────────────────────────────
//   Add a permission when a route (or a specific action within a route) needs
//   it. Don't pre-add capabilities for features that don't exist yet — every
//   permission is a toggle a future school admin might see, and a toggle that
//   does nothing is worse than no toggle.

export const PERMISSIONS = [
  // ── School (the tenant profile — exactly one per school) ──
  "school:read",           // view school name, motto, contact info
  "school:update",         // edit school profile (owner only)

  "users:read",
  "users:create",
  "users:update",
  "users:suspend",         // flip status active ↔ suspended
  "users:reset_password",  // trigger a forced password reset

  // ── Roles (per-school roles and their permission grants) ──
  "roles:read",
  "roles:assign",          // grant / revoke a role from a membership
  "roles:manage_permissions", // edit what a role can do (owner-only by default)

  // ── Audit ──
  "audit:read",            // view the audit log at this school

] as const;

export type Permission = (typeof PERMISSIONS)[number];

// Runtime guard — for INPUT VALIDATION, not for route authoring.
//
// Use this when a string comes from a boundary you don't control:
//   - a request body (admin submits a list of permissions for a role)
//   - a DB row during a migration or startup sanity check
//   - a test asserting every grant in `role_permissions` is a known permission
//
// Do NOT use this in route handlers — route handlers should reference
// `Permission` (the type), so the check happens at compile time and typos
// fail the build instead of throwing at runtime.
//
// The `as readonly string[]` cast is required: tuple `.includes` only accepts
// the literal union type, so passing a plain `string` fails without the cast.
//
// If this list grows past ~50 items and this becomes a hot path, switch to a
// Set (`new Set<string>(PERMISSIONS).has(s)`). The signature stays the same,
// so no caller changes when that happens.
export const isPermission = (s: string): s is Permission =>
  (PERMISSIONS as readonly string[]).includes(s);