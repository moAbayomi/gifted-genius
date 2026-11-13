// modules/rbac/can.ts
import type { Permission } from "./permissions.js";
import { EMPTY_SCOPE, type ActorScope } from "./scope.js";

export type Actor = {
  userId: string;
  membershipId: string;
  schoolId: string;
  /** Highest rank among the actor's roles. 0 if no roles. */
  rank: number;
  permissions: ReadonlySet<Permission>;
  /** Request-time assignments. Absent on test/fake actors = empty scope. */
  scope?: ActorScope;
};

export type Resource = {
  schoolId?: string;
  classId?: string;
  offeringId?: string;
};

/** Permissions whose base form is limited to assignment scope. */
const SCOPED_PERMISSIONS = new Set(["enrollments:read", "enrollments:manage"]);

export type ScopeSelection = "all" | ReadonlySet<string>;

/**
 * The class set a permission can reach, or "all" for school-wide access.
 * An empty set means the actor has no scoped reach.
 */
export function scopeFor(
  actor: Actor,
  permission: Permission,
): ScopeSelection {
  if (actor.permissions.has(`${permission}_all` as Permission)) return "all";
  if (!actor.permissions.has(permission)) return new Set<string>();
  if (!SCOPED_PERMISSIONS.has(permission)) return "all";

  const scope = actor.scope ?? EMPTY_SCOPE;
  return new Set([
    ...scope.classIds,
    ...scope.formTeacherClassIds,
    ...scope.taughtClassIds,
  ]);
}

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
  const hasAll = actor.permissions.has(`${permission}_all` as Permission);
  if (!actor.permissions.has(permission) && !hasAll) return false;
  if (
    resource?.schoolId !== undefined &&
    resource.schoolId !== actor.schoolId
  ) {
    return false;
  }
  if (!resource) return true;
  if (hasAll) return true;

  const scope = scopeFor(actor, permission);
  if (scope === "all") return true;
  if (resource.classId !== undefined) return scope.has(resource.classId);
  if (resource.offeringId !== undefined) {
    return (actor.scope ?? EMPTY_SCOPE).offeringIds.includes(resource.offeringId);
  }
  // Resource with only schoolId: the permission check is sufficient.
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
