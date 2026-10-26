// modules/rbac/rank.ts
import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import {
  memberships,
  membershipRoles,
  rolePermissions,
  roles,
} from "../../db/schema/index.js";
import { one } from "../../shared/utils/assert.js";
import { AppError } from "../../shared/lib/errors.js";
import {
  canManageMember,
  canAssignRole,
  type Actor,
  type AssignableRole,
} from "./can.js";
import type { Permission } from "./permissions.js";

export async function loadMembershipRank(
  executor: DbExecutor,
  membershipId: string,
): Promise<number> {
  const row = one(
    await executor
      .select({ rank: sql<number>`coalesce(max(${roles.rank}), 0)` })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, membershipId)),
  );
  return Number(row.rank);
}

export async function loadRolePermissions(
  executor: DbExecutor,
  roleId: string,
): Promise<Permission[]> {
  const rows = await executor
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.permission as Permission);
}

/**
 * Assert that the actor may perform a destructive action on the target
 * membership.
 *
 * School is in the WHERE, not compared after the fact — so a cross-school
 * ID is indistinguishable from a nonexistent one (both 404). No id-probing.
 *
 * No self-target shortcut. Self-target fails the rank check because your
 * rank is not strictly greater than your own. Admin services add an
 * explicit self-check with a "use /auth/change-password" message.
 */
export async function assertCanActOnUser(
  executor: DbExecutor,
  actor: Actor,
  targetMembershipId: string,
): Promise<void> {
  const [target] = await executor
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.id, targetMembershipId),
        eq(memberships.schoolId, actor.schoolId),
      ),
    );

  // Not found in THIS school — same 404 whether the ID is cross-school
  // or nonexistent. The caller learns nothing about other schools' rows.
  if (!target) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  const targetRank = await loadMembershipRank(executor, target.id);
  if (!canManageMember(actor, targetRank)) {
    // 403 because the target is visible (same school) but not touchable.
    throw new AppError(
      403,
      "FORBIDDEN",
      "You cannot perform this action on a user at or above your rank",
    );
  }
}

export async function assertCanAssignRole(
  executor: DbExecutor,
  actor: Actor,
  roleId: string,
): Promise<void> {
  const [role] = await executor
    .select({ rank: roles.rank })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.schoolId, actor.schoolId)));

  if (!role) {
    throw new AppError(404, "NOT_FOUND", "Role not found");
  }

  const permissions = await loadRolePermissions(executor, roleId);
  const roleForCheck: AssignableRole = {
    rank: Number(role.rank),
    permissions,
  };

  if (!canAssignRole(actor, roleForCheck)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You cannot assign this role (rank too high, or it grants a permission you lack)",
    );
  }
}
