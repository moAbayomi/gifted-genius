// modules/rbac/can.ts
import type { Permission } from "./permissions.js";

export type Actor = {
  userId: string;
  membershipId: string;
  schoolId: string;
  /** Highest rank among the actor's roles. 0 if no roles. */
  rank: number;
  permissions: ReadonlySet<Permission>;
};

export type Resource = { schoolId?: string };

export type AssignableRole = {
  rank: number;
  permissions: readonly Permission[];
};

/**
 * Does the actor hold this permission, and if the resource is school-scoped,
 * is it in the actor's school?
 *
 * Pure. No DB. No Express. One Set lookup plus a string comparison.
 */
export function can(
  actor: Actor,
  permission: Permission,
  resource?: Resource,
): boolean {
  if (!actor.permissions.has(permission)) return false;
  if (
    resource?.schoolId !== undefined &&
    resource.schoolId !== actor.schoolId
  ) {
    return false;
  }
  return true;
}

/**
 * May the actor perform a destructive action on a member of the given rank?
 *
 * Strictly higher — peers cannot act on each other, and a rank-0 actor
 * (no roles) can act on nobody, including another rank-0.
 */
export function canManageMember(actor: Actor, targetRank: number): boolean {
  return actor.rank > targetRank;
}

/**
 * May the actor assign this role?
 *
 * Two conditions, both required:
 *   1. Role rank is strictly below the actor's rank — you can't grant
 *      a role at or above your own authority level.
 *   2. Every permission the role grants is held by the actor — you can't
 *      grant a capability you don't have yourself. This closes the
 *      "assign a role to escalate" vector even when ranks would permit it.
 */
export function canAssignRole(actor: Actor, role: AssignableRole): boolean {
  if (role.rank >= actor.rank) return false;
  return role.permissions.every((p) => actor.permissions.has(p));
}
