// modules/roles/service.ts
import type { DbExecutor, Tx } from "../../db/types.js";
import type { Actor } from "../rbac/can.js";
import { canAssignRole } from "../rbac/can.js";
import type { Permission } from "../rbac/permissions.js";
import { AppError } from "../../shared/lib/errors.js";
import { recordAudit } from "../../shared/audit/record.js";
import * as repo from "./repository.js";
import * as usersRepo from "../users/repository.js";
import type { Role } from "../../db/schema/index.js";
import { assertCanActOnUser } from "../rbac/rank.js";

// ═══════════════════════════════════════════════════════════════════
// GET /roles — list all roles at this school
// ═══════════════════════════════════════════════════════════════════

/**
 * List roles at the actor's school, ordered by rank ascending.
 * No additional permission check beyond requirePermission('roles:read')
 * at the route — every role in the school is listable by anyone who can
 * list roles. That's safe: role definitions aren't sensitive; the
 * permissions inside each role only matter when someone tries to USE them.
 */
export async function listRoles(
  executor: DbExecutor,
  actor: Actor,
): Promise<Role[]> {
  return repo.listRoles(executor, actor.schoolId);
}

// ═══════════════════════════════════════════════════════════════════
// POST /users/:id/roles — assign a role to an existing member
// ═══════════════════════════════════════════════════════════════════

/**
 * Assign one role to a member.
 *
 * Uses the same guards as the other admin actions in users/service.ts:
 *   1. Self-check — can't assign roles to yourself (use another admin).
 *   2. assertCanActOnUser — must be same school, target strictly below
 *      your rank.
 *   3. canAssignRole — the role's rank must be strictly below yours, AND
 *      every permission the role grants must be one you hold. (You can't
 *      grant a capability you don't have.)
 *
 * Why these are needed: adding a role changes what a person can DO. Even
 * though nothing is removed, granting a role to a peer or superior is
 * escalation — the recipient gains capabilities at or above your level.
 * Same rank discipline as removeRole, suspend, reset-password.
 *
 * Idempotent: re-assigning the same role is a no-op (the composite PK
 * on membership_roles makes the duplicate insert a silent skip via
 * onConflictDoNothing). Frontend can safely retry.
 */
export async function assignRole(
  tx: Tx,
  actor: Actor,
  targetMembershipId: string,
  roleKey: string,
): Promise<void> {
  if (targetMembershipId === actor.membershipId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You cannot assign roles to yourself. Ask another admin.",
    );
  }

  // NEW: rank + school check
  await assertCanActOnUser(tx, actor, targetMembershipId);
  // 1. Target exists in this school — school-scoped in WHERE, 404 for cross-school
  const target = await usersRepo.findMember(
    tx,
    actor.schoolId,
    targetMembershipId,
  );
  if (!target) {
    throw new AppError(404, "NOT_FOUND", "Member not found");
  }

  // 2. Role exists at this school, by key
  const role = await repo.findRoleByKey(tx, actor.schoolId, roleKey);
  if (!role) {
    throw new AppError(404, "NOT_FOUND", "Role not found");
  }

  // 3. Actor may assign this role (rank + permission-subset rule)
  const rolePerms = await repo.findRolePermissions(tx, role.id);
  if (!canAssignRole(actor, { rank: role.rank, permissions: rolePerms })) {
    throw new AppError(
      403,
      "FORBIDDEN",
      `You cannot assign the '${role.key}' role (rank too high, or it grants a permission you lack)`,
    );
  }

  // 4. Do the work — idempotent if already assigned
  await usersRepo.insertMembershipRoles(tx, {
    membershipId: targetMembershipId,
    schoolId: actor.schoolId,
    roleIds: [role.id],
    assignedBy: actor.membershipId,
  });

  // 5. Audit
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "membership.role_assigned",
    targetType: "membership",
    targetId: targetMembershipId,
    after: { roleKey: role.key },
  });
}

// ═══════════════════════════════════════════════════════════════════
// PUT /roles/:id/permissions — edit a role's permission set
// ═══════════════════════════════════════════════════════════════════

/**
 * Replace a role's permission set.
 *
 * Two invariants enforced here (schema can't enforce them):
 *
 *  1. The owner role's permissions are LOCKED. The owner is the
 *     catch-all "root" role — if you could remove `roles:manage_permissions`
 *     from it, the school would become permanently unadministrable.
 *     Owner permissions ALWAYS equal the full catalogue, and that's a
 *     database invariant expressed by DEFAULT_ROLES. Refuse any edit.
 *
 *  2. Delegation rule: every permission in the NEW set must be held by
 *     the actor. You cannot grant a capability you don't have yourself.
 *     Otherwise an admin with `roles:manage_permissions` (but not
 *     `users:delete`) could grant `users:delete` to a role, assign that
 *     role to themselves, and gain the permission — escalation via
 *     permission editing.
 *
 * The rule checks only what's being ADDED. Removing permissions is
 * always allowed (it never escalates). If the new set is a strict subset
 * of the current set, this always passes.
 *
 * MUST be called inside db.transaction — replaceRolePermissions does
 * delete-then-insert, and a partial failure would leave the role with
 * zero permissions.
 */
export async function updateRolePermissions(
  tx: Tx,
  actor: Actor,
  roleId: string,
  newPermissions: Permission[],
): Promise<void> {
  // 1. Role exists in this school
  const role = await repo.findRole(tx, actor.schoolId, roleId);
  if (!role) {
    throw new AppError(404, "NOT_FOUND", "Role not found");
  }

  // 2. Owner permissions are immutable
  if (role.key === repo.OWNER_ROLE_KEY) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "The owner role's permissions cannot be changed",
    );
  }

  if (role.rank >= actor.rank) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You can only edit roles ranked below your own",
    );
  }

  // 3. Delegation rule — every NEW permission must be held by the actor
  const missing = newPermissions.filter((p) => !actor.permissions.has(p));
  if (missing.length > 0) {
    throw new AppError(
      403,
      "FORBIDDEN",
      `You cannot grant permissions you do not hold: ${missing.join(", ")}`,
    );
  }

  // 4. Load current permissions for audit (before-snapshot)
  const before = await repo.findRolePermissions(tx, roleId);

  // 5. Replace — delete + insert
  await repo.replaceRolePermissions(tx, roleId, newPermissions);

  // 6. Audit — full before/after for compliance
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "role.permissions_updated",
    targetType: "role",
    targetId: roleId,
    before: { permissions: before },
    after: { permissions: newPermissions },
    metadata: { roleKey: role.key },
  });
}
