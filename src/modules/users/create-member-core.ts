import type { Tx } from "../../db/types.js";
import { AppError } from "../../shared/lib/errors.js";
import { recordAudit } from "../../shared/audit/record.js";
import { canAssignRole, type Actor } from "../rbac/can.js";
import {
  createMembership,
  findMember,
  findRolesByKeys,
  findUserByEmail,
  insertMembershipRoles,
  insertUser,
  loadRolePermissions,
  type MemberRow,
} from "./repository.js";

export interface CreateMemberCoreInput {
  firstName: string;
  lastName: string;
  email?: string | undefined;
  username?: string | undefined;
  roleKeys: string[];
}

export interface PrecomputedCredentials {
  /** The raw temporary password — returned to the client IF a new user was created. */
  temporaryPassword: string;
  /** The argon2 hash of the temporary password — used when inserting the user. */
  passwordHash: string;
}

export interface CreateMemberCoreResult {
  member: MemberRow;
  temporaryPassword?: string | undefined;
  userId: string;
  membershipId: string;
  userWasCreated: boolean;
}

/**
 * The shared core of "create a member of this school".
 *
 * Both the generic invite flow (`createUser`) and the student flow call this.
 * It owns the rules that must be identical in both places:
 *   - role keys resolve inside the actor's school
 *   - the actor may assign every role (rank + permission subset)
 *   - an existing email is reused; a new email creates a user row
 *   - a username-only member is always a new user
 *   - membership uniqueness and role assignment
 *   - the membership audit row
 *
 * It deliberately does not know about student profiles. The student service
 * calls this first, then inserts the profile in the same transaction.
 */
export async function createMemberCore(
  tx: Tx,
  actor: Actor,
  input: CreateMemberCoreInput,
  precomputed: PrecomputedCredentials,
  via: string,
): Promise<CreateMemberCoreResult> {
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
    metadata: { userWasCreated, via },
  });

  const member = await findMember(tx, actor.schoolId, membership.id);
  if (!member) {
    throw new AppError(500, "INTERNAL", "Membership created but not found");
  }

  return {
    member,
    temporaryPassword,
    userId,
    membershipId: membership.id,
    userWasCreated,
  };
}
