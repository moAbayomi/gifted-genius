import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import {
  roles,
  rolePermissions,
  memberships,
  membershipRoles,
  schools,
  users,
  type Role,
  type Membership,
} from "../../db/schema/index.js";
import type { Permission } from "../rbac/permissions.js";

/**
 * The role key that identifies the school owner. Constant because the
 * last-admin invariant, the "owner permissions are locked" rule, and the
 * owner-role rank checks all need to agree on this string. If you ever
 * rename the role (school_admin, proprietor, etc.), change it here.
 */
export const OWNER_ROLE_KEY = "owner";

// ── Role lookups (school-scoped) ─────────────────────────────────

/**
 * Find a role by ID, scoped to the school. Returns null if not found OR
 * if the role belongs to another school. The two cases are indistinguishable
 * to the caller — no id-probing leak.
 */
export async function findRole(
  executor: DbExecutor,
  schoolId: string,
  roleId: string,
): Promise<Role | null> {
  const [role] = await executor
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.schoolId, schoolId)));
  return role ?? null;
}

/**
 * Find a role by key (e.g. "teacher"), scoped to the school.
 * Role keys are unique per school (`roles_school_key_uq`), so this returns
 * at most one row.
 */
export async function findRoleByKey(
  executor: DbExecutor,
  schoolId: string,
  key: string,
): Promise<Role | null> {
  const [role] = await executor
    .select()
    .from(roles)
    .where(and(eq(roles.key, key), eq(roles.schoolId, schoolId)));
  return role ?? null;
}

/**
 * List all roles at a school, ordered by rank ascending (lowest authority
 * first). Used by GET /roles — the frontend shows the picker in this order.
 */
export async function listRoles(
  executor: DbExecutor,
  schoolId: string,
): Promise<Role[]> {
  return executor
    .select()
    .from(roles)
    .where(eq(roles.schoolId, schoolId))
    .orderBy(roles.rank, roles.key);
}

// ── Permission lookup for a single role ──────────────────────────

/**
 * Load the permission strings granted to a single role.
 * Returns [] if the role has no permissions (shouldn't happen for system
 * roles, but custom roles could theoretically be created empty later).
 *
 * Different from users/repository.ts's loadRolePermissions — that one takes
 * an array of role IDs and returns a Record. This one is for the single-role
 * case (PUT /roles/:id/permissions).
 */
export async function findRolePermissions(
  executor: DbExecutor,
  roleId: string,
): Promise<Permission[]> {
  const rows = await executor
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.permission as Permission);
}

// ── Membership lookup (light — no join) ──────────────────────────

/**
 * Light membership lookup for role operations. Returns the raw membership
 * row — no user join, no roles aggregation. Used to:
 *   - verify the target membership exists in this school (404 gate)
 *   - check its status (active/inactive/suspended)
 *   - read its userId (for audit metadata)
 *
 * For full member details (with user fields + roles), use
 * users/repository.ts's findMember.
 */
export async function findMembershipRow(
  executor: DbExecutor,
  schoolId: string,
  membershipId: string,
): Promise<Membership | null> {
  const [membership] = await executor
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.schoolId, schoolId), eq(memberships.id, membershipId)),
    );
  return membership ?? null;
}

// ── Membership-role deletion ────────────────────────────────────

/**
 * Delete a specific (membership, role) assignment.
 * Idempotent — no error if the row doesn't exist. The service checks
 * existence beforehand for audit purposes if needed; the repository just
 * does the delete.
 *
 * Not school-scoped in the WHERE: the caller (service) has already verified
 * the membership belongs to this school via findMembershipRow. The delete
 * operates on (membershipId, roleId), both of which the caller has validated.
 */
export async function deleteMembershipRole(
  executor: DbExecutor,
  membershipId: string,
  roleId: string,
): Promise<void> {
  await executor
    .delete(membershipRoles)
    .where(
      and(
        eq(membershipRoles.membershipId, membershipId),
        eq(membershipRoles.roleId, roleId),
      ),
    );
}

// ── Permission set replacement ──────────────────────────────────

/**
 * Replace a role's full permission set.
 *
 * MUST be called inside a transaction — a partial failure between delete
 * and insert would leave the role with zero permissions (an unusable state).
 * The service wraps this in db.transaction().
 *
 * Pattern: DELETE all → INSERT new set. The PK on (role_id, permission)
 * means a straight replace would need conflict handling; delete-first
 * sidesteps that entirely.
 */
export async function replaceRolePermissions(
  executor: DbExecutor,
  roleId: string,
  permissions: Permission[],
): Promise<void> {
  await executor
    .delete(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));

  if (permissions.length > 0) {
    await executor
      .insert(rolePermissions)
      .values(permissions.map((permission) => ({ roleId, permission })));
  }
}

// ── Last-admin invariant primitives ─────────────────────────────

/**
 * Acquire an exclusive row lock on the school.
 *
 * `SELECT ... FOR UPDATE` locks the row until the current transaction
 * commits or rolls back. Concurrent transactions trying to lock the same
 * school will block here.
 *
 * This is the per-school mutex that makes "count owners → delete one if
 * safe" atomic. Without it, two concurrent "remove owner role" requests
 * could each see count=2 and each delete a role, leaving the school with
 * zero owners.
 *
 * Does nothing useful OUTSIDE a transaction (locks release at commit, and
 * autocommit means it's released immediately). Must be called inside
 * db.transaction(...).
 */
export async function lockSchoolRow(
  executor: DbExecutor,
  schoolId: string,
): Promise<void> {
  await executor
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .for("update");
}

/**
 * Return the membership IDs of all ACTIVE school owners.
 * "Active" means:
 *   - membership.status = 'active'   (not suspended/inactive)
 *   - users.status = 'active'        (not suspended globally)
 *   - has the 'owner' role
 *
 * Used by assertNotLastAdmin: if the target is the only active owner,
 * removing their owner role (or suspending them) would leave the school
 * unadministrable → 409.
 *
 * A suspended owner doesn't count — they can't log in, so they can't
 * administer. The invariant is "a school has at least one FUNCTIONING
 * administrator," not "at least one row in a table."
 */
export async function activeOwnerMembershipIds(
  executor: DbExecutor,
  schoolId: string,
): Promise<string[]> {
  const rows = await executor
    .selectDistinct({ membershipId: membershipRoles.membershipId })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .innerJoin(memberships, eq(memberships.id, membershipRoles.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.schoolId, schoolId),
        eq(memberships.status, "active"),
        eq(users.status, "active"),
        eq(roles.key, OWNER_ROLE_KEY),
      ),
    );

  return rows.map((r) => r.membershipId);
}
