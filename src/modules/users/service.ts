import { and, eq} from "drizzle-orm";
import type { DbExecutor, Tx } from "../../db/types.js";
import {
  memberships,
  membershipRoles,
  roles,
  sessions,
  users,
  type User,
} from "../../db/schema/index.js";
import { one } from "../../shared/utils/assert.js";
import { AppError } from "../../shared/lib/errors.js";
import { hashPassword } from "../../shared/utils/password.js";
import { can, canAssignRole, type Actor } from "../rbac/can.js";
import { assertCanActOnUser } from "../rbac/rank.js";
import { recordAudit } from "../../shared/audit/record.js";
import {
  createMembership,
  findMember,
  findRolesByKeys,
  findUserByEmail,
  insertMembershipRoles,
  insertUser,
  listMembers,
  loadRolePermissions,
} from "./repository.js";
import type { MemberRow, ListMembersResult } from "./repository.js";
import type { CreateUserInput, UpdateUserInput } from "./schema.js";
import type { PageQuery } from "../../shared/dto/pagination.js";
import { assertNoOtherSchoolMemberships } from "../../shared/utils/cross-school.js";
import { isUniqueViolation } from "../../shared/errors/pg-errors.js";
import {
  activeOwnerMembershipIds,
  lockSchoolRow,
} from "../roles/repository.js";

// ═══════════════════════════════════════════════════════════════════
// Admin actions on existing members
// ═══════════════════════════════════════════════════════════════════

// ── Reset password (admin action) ─────────────────────────────────
export async function resetUserPassword(
  tx: Tx,
  actor: Actor,
  targetMembershipId: string,
  newPassword: string,
): Promise<void> {
  if (targetMembershipId === actor.membershipId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Use /auth/change-password to change your own password",
    );
  }

  await assertCanActOnUser(tx, actor, targetMembershipId);

  const target = one(
    await tx
      .select()
      .from(memberships)
      .where(eq(memberships.id, targetMembershipId)),
  );

  await assertNoOtherSchoolMemberships(
    tx,
    target.userId,
    actor.schoolId,
    "their password",
  );

  if (!can(actor, "users:reset_password")) {
    throw new AppError(403, "FORBIDDEN", "Cannot reset this user's password");
  }

  const passwordHash = await hashPassword(newPassword);
  await tx
    .update(users)
    .set({ passwordHash, mustChangePassword: true })
    .where(eq(users.id, target.userId));

  await tx.delete(sessions).where(eq(sessions.userId, target.userId));

  await recordAudit(tx, {
    schoolId: target.schoolId,
    actorMembershipId: actor.membershipId,
    action: "user.password_reset",
    targetType: "user",
    targetId: target.userId,
    metadata: {},
  });
}

// ── Suspend user (admin action) ───────────────────────────────────
export async function suspendUser(
  tx: Tx,
  actor: Actor,
  targetMembershipId: string,
): Promise<void> {
  if (targetMembershipId === actor.membershipId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You cannot suspend yourself. Ask another admin if you need to leave.",
    );
  }

  await assertCanActOnUser(tx, actor, targetMembershipId);

  const target = one(
    await tx
      .select()
      .from(memberships)
      .where(eq(memberships.id, targetMembershipId)),
  );

  if (!can(actor, "users:suspend")) {
    throw new AppError(403, "FORBIDDEN", "Cannot suspend this user");
  }

  await tx
    .update(memberships)
    .set({ status: "suspended" })
    .where(eq(memberships.id, targetMembershipId));

  await tx
    .delete(sessions)
    .where(eq(sessions.activeMembershipId, targetMembershipId));

  await recordAudit(tx, {
    schoolId: target.schoolId,
    actorMembershipId: actor.membershipId,
    action: "membership.suspended",
    targetType: "membership",
    targetId: targetMembershipId,
    before: { status: target.status },
    after: { status: "suspended" },
  });
}

export async function reactivateUser(
  tx: Tx,
  actor: Actor,
  targetMembershipId: string,
): Promise<void> {
  // 1. Self-check — reactivating yourself is weird (you're not suspended
  //    if you have an active session), but be defensive
  if (targetMembershipId === actor.membershipId) {
    throw new AppError(403, "FORBIDDEN", "You cannot reactivate yourself.");
  }

  // 2. Rank + school
  await assertCanActOnUser(tx, actor, targetMembershipId);

  // 3. Load target
  const target = one(
    await tx
      .select()
      .from(memberships)
      .where(eq(memberships.id, targetMembershipId)),
  );

  // 4. Permission — reuse users:suspend. Same category of action.
  //    If you want a separate permission later, add `users:reactivate`
  //    to DEFAULT_ROLES for the roles that should have it.
  if (!can(actor, "users:suspend")) {
    throw new AppError(403, "FORBIDDEN", "Cannot reactivate this user");
  }

  // 5. No-op if already active — idempotent
  if (target.status === "active") {
    return; // already active, nothing to do
  }

  // 6. Do the work
  await tx
    .update(memberships)
    .set({ status: "active" })
    .where(eq(memberships.id, targetMembershipId));

  // 7. NO session revocation — the target has no sessions (they were
  //    suspended, and suspension revoked any they had). If they had
  //    somehow kept one, it's expired or invalid by now.

  // 8. Audit
  await recordAudit(tx, {
    schoolId: target.schoolId,
    actorMembershipId: actor.membershipId,
    action: "membership.reactivated",
    targetType: "membership",
    targetId: targetMembershipId,
    before: { status: target.status },
    after: { status: "active" },
  });
}

// ── Remove role from membership (admin action) ────────────────────
export async function removeRoleFromMembership(
  tx: Tx,
  actor: Actor,
  targetMembershipId: string,
  roleId: string,
): Promise<void> {
  if (targetMembershipId === actor.membershipId) {
    throw new AppError(403, "FORBIDDEN", "You cannot remove your own roles.");
  }

  await assertCanActOnUser(tx, actor, targetMembershipId);

  const target = one(
    await tx
      .select()
      .from(memberships)
      .where(eq(memberships.id, targetMembershipId)),
  );

  if (!can(actor, "roles:assign")) {
    throw new AppError(403, "FORBIDDEN", "Cannot remove roles");
  }

  const [role] = await tx
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.schoolId, actor.schoolId)));
  if (!role) throw new AppError(404, "NOT_FOUND", "Role not found");

  if (role.key === "owner") {
    await lockSchoolRow(tx, target.schoolId);

    const owners = await activeOwnerMembershipIds(tx, target.schoolId);

    if (owners.length === 1 && owners[0] === targetMembershipId) {
      throw new AppError(
        403,
        "FORBIDDEN",
        "Cannot remove the last owner. Transfer ownership first.",
      );
    }
  }

  const deleted = await tx
    .delete(membershipRoles)
    .where(
      and(
        eq(membershipRoles.membershipId, targetMembershipId),
        eq(membershipRoles.roleId, roleId),
      ),
    )
    .returning({ membershipId: membershipRoles.membershipId });

  // Only write an audit row if something was actually deleted
  if (deleted.length > 0) {
    await recordAudit(tx, {
      schoolId: actor.schoolId,
      actorMembershipId: actor.membershipId,
      action: "membership.role_revoked",
      targetType: "membership",
      targetId: targetMembershipId,
      before: { roleKey: role.key },
      after: null,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Member management (invite + list)
// ═══════════════════════════════════════════════════════════════════

export interface CreateUserResult {
  member: MemberRow;
  /**
   * Only present when a NEW user was created. Absent when an existing user
   * was linked to this school — they use their existing password.
   */
  temporaryPassword?: string | undefined;
}

export interface PrecomputedCredentials {
  /** The raw temporary password — returned to the client IF a new user was created. */
  temporaryPassword: string;
  /** The argon2 hash of the temporary password — used when inserting the user. */
  passwordHash: string;
}

/**
 * Invite a person to the current school with one or more roles.
 * All six steps in one transaction (see comments below).
 */
export async function createUser(
  tx: Tx,
  actor: Actor,
  input: CreateUserInput,
  precomputed: PrecomputedCredentials,
): Promise<CreateUserResult> {
  // ── Step 1: resolve role keys to roles IN THIS SCHOOL ───────────
  const roleRows = await findRolesByKeys(tx, actor.schoolId, input.roleKeys);
  if (roleRows.length !== input.roleKeys.length) {
    const found = new Set(roleRows.map((r) => r.key));
    const missing = input.roleKeys.filter((k) => !found.has(k));
    throw new AppError(
      400,
      "UNKNOWN_ROLE",
      `Unknown role(s) for this school: ${missing.join(", ")}`,
    );
  }

  // ── Step 2: verify actor can assign EVERY role ──────────────────
  const permsByRole = await loadRolePermissions(
    tx,
    roleRows.map((r) => r.id),
  );
  for (const role of roleRows) {
    const rolePerms = permsByRole[role.id] ?? [];
    if (!canAssignRole(actor, { rank: role.rank, permissions: rolePerms })) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `You cannot assign the '${role.key}' role (rank too high, or it grants a permission you lack)`,
      );
    }
  }

  // ── Step 3: get or create the user row ──────────────────────────
  let userId: string;
  let temporaryPassword: string | undefined;
  let userWasCreated = false;

  if (input.email) {
    const existing = await findUserByEmail(tx, input.email);
    if (existing) {
      userId = existing.id;
      // no temp password — they use their existing one
    } else {
      const created = await insertUser(tx, {
        email: input.email,
        passwordHash: precomputed.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        mustChangePassword: true,
      });
      userId = created.id;
      temporaryPassword = precomputed.temporaryPassword;
      userWasCreated = true;
    }
  } else {
    // Username-only user (student without email) — always new

    const created = await insertUser(tx, {
      email: null,
      passwordHash: precomputed.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      mustChangePassword: true,
    });
    userId = created.id;
    temporaryPassword = precomputed.temporaryPassword;
    userWasCreated = true;
  }

  // ── Step 4: create the membership ───────────────────────────────
  // Unique violations (schoolId+userId, schoolId+username) are translated
  // to AppError(409, ...) inside the repo.
  const membership = await createMembership(tx, {
    userId,
    schoolId: actor.schoolId,
    username: input.username ?? null,
    status: "active",
  });

  // ── Step 5: assign roles ────────────────────────────────────────
  await insertMembershipRoles(tx, {
    membershipId: membership.id,
    schoolId: actor.schoolId,
    roleIds: roleRows.map((r) => r.id),
    assignedBy: actor.membershipId,
  });

  // ── Step 6: audit ───────────────────────────────────────────────
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "membership.created",
    targetType: "membership",
    targetId: membership.id,
    after: {
      userId,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      roleKeys: input.roleKeys,
    },
    metadata: { userWasCreated, via: "POST /users" },
  });

  const member = await findMember(tx, actor.schoolId, membership.id);
  if (!member) {
    throw new AppError(500, "INTERNAL", "Membership created but not found");
  }

  return { member, temporaryPassword };
}

/**
 * List members of the actor's school, paginated.
 * Takes `actor` (not `schoolId`) — the school is the actor's school by
 * construction. There's no way for a route to pass a different schoolId.
 */
export async function listUsers(
  executor: DbExecutor,
  actor: Actor,
  page: PageQuery,
): Promise<ListMembersResult> {
  return listMembers(executor, actor.schoolId, page);
}

export async function updateUser(
  tx: Tx,
  actor: Actor,
  targetMembershipId: string,
  input: UpdateUserInput,
): Promise<MemberRow> {
  // 1. Self-check
  if (targetMembershipId === actor.membershipId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Use /me to edit your own profile. Contact another admin for name corrections.",
    );
  }

  // 2. Rank + school
  await assertCanActOnUser(tx, actor, targetMembershipId);

  // 3. Load the JOINED member — has both membership fields and user fields
  const target = await findMember(tx, actor.schoolId, targetMembershipId);
  if (!target) {
    throw new AppError(404, "NOT_FOUND", "Member not found");
  }

  // 4. Permission
  if (!can(actor, "users:update")) {
    throw new AppError(403, "FORBIDDEN", "Cannot edit this user");
  }

  // 5. Cross-school check ONLY if email is changing
  if (input.email !== undefined && input.email !== target.email) {
    await assertNoOtherSchoolMemberships(
      tx,
      target.userId,
      actor.schoolId,
      "their email",
    );
  }

  // 6. Build the users-row update (only user-table fields)
  const userUpdate: Partial<
    Pick<User, "firstName" | "lastName" | "phone" | "email">
  > = {};
  if (input.firstName !== undefined) userUpdate.firstName = input.firstName;
  if (input.lastName !== undefined) userUpdate.lastName = input.lastName;
  if (input.phone !== undefined) userUpdate.phone = input.phone;
  if (input.email !== undefined) userUpdate.email = input.email;

  if (Object.keys(userUpdate).length > 0) {
    await tx.update(users).set(userUpdate).where(eq(users.id, target.userId));
  }

  // 7. Username is on memberships, not users
  if (input.username !== undefined) {
    try {
      await tx
        .update(memberships)
        .set({ username: input.username })
        .where(eq(memberships.id, targetMembershipId));
    } catch (err) {
      if (isUniqueViolation(err, "memberships_school_username_uq")) {
        throw new AppError(
          409,
          "USERNAME_TAKEN",
          "That username is already taken at this school",
        );
      }
      throw err;
    }
  }

  // 8. Audit — before-snapshot from the joined row, after from input
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "user.updated",
    targetType: "user",
    targetId: target.userId,
    before: {
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      username: target.username,
    },
    after: input,
  });

  // 9. Reload and return
  const updated = await findMember(tx, actor.schoolId, targetMembershipId);
  if (!updated) {
    throw new AppError(500, "INTERNAL", "Member vanished after update");
  }
  return updated;
}
