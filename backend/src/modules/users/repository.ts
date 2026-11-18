// modules/users/repository.ts
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import {
  users,
  memberships,
  membershipRoles,
  roles,
  rolePermissions,
  type User,
  type Membership,
  type Role,
} from "../../db/schema/index.js";
import type { Permission } from "../rbac/permissions.js";
import { AppError } from "../../shared/lib/errors.js";
import { isUniqueViolation } from "../../shared/errors/pg-errors.js";
import { one } from "../../shared/utils/assert.js";
import type { PageQuery } from "../../shared/dto/pagination.js";

// ── The joined-row type the DTO consumes ──────────────────────────
export interface MemberRow {
  // From memberships
  membershipId: string;
  username: string | null;
  status: "active" | "inactive" | "suspended";
  joinedAt: Date;
  // From users (userId is internal — not exposed in the DTO)
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  // Aggregated from membership_roles + roles
  roleKeys: string[];
}

/**
 * The SELECT columns for a "member" (membership joined to user + roles).
 * Shared between findMember and listMembers — one shape, one place to change.
 *
 * The roleKeys aggregation:
 *   - array_agg(r.key ORDER BY r.key)   → alphabetical, predictable
 *   - FILTER (WHERE r.key IS NOT NULL)  → drops NULLs from LEFT JOIN misses
 *   - COALESCE(..., ARRAY[]::text[])    → empty array for roleless memberships
 */
const memberSelectColumns = {
  membershipId: memberships.id,
  username: memberships.username,
  status: memberships.status,
  joinedAt: memberships.joinedAt,
  userId: users.id,
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  phone: users.phone,
  roleKeys: sql<string[]>`
    COALESCE(
      array_agg(${roles.key} ORDER BY ${roles.key})
      FILTER (WHERE ${roles.key} IS NOT NULL),
      ARRAY[]::text[]
    )
  `,
};

// ── findMember — single member, school-scoped ─────────────────────

/**
 * Look up a member by membership ID, scoped to the school.
 * Returns null if not found OR if the membership belongs to another school.
 * The two cases are indistinguishable to the caller — no id-probing leak.
 */
export async function findMember(
  executor: DbExecutor,
  schoolId: string,
  membershipId: string,
): Promise<MemberRow | null> {
  const [row] = await executor
    .select(memberSelectColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(
      and(eq(memberships.schoolId, schoolId), eq(memberships.id, membershipId)),
    )
    .groupBy(memberships.id, users.id);

  return row ?? null;
}

// ── listMembers — paginated list, school-scoped ───────────────────

export interface ListMembersResult {
  rows: MemberRow[];
  total: number;
}

/**
 * List members of a school with pagination.
 * Order by (createdAt DESC, id DESC) for a stable total order —
 * `createdAt` alone can collide (two inserts in the same ms), which makes
 * pagination unstable. Adding `id` as tiebreaker fixes it.
 *
 * Two queries: one for the page, one for the total count.
 * The count query doesn't join — it just counts memberships in the school.
 */
export async function listMembers(
  executor: DbExecutor,
  schoolId: string,
  page: PageQuery,
): Promise<ListMembersResult> {
  const rows = await executor
    .select(memberSelectColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(eq(memberships.schoolId, schoolId))
    .groupBy(memberships.id, users.id)
    .orderBy(sql`${memberships.createdAt} DESC, ${memberships.id} DESC`)
    .limit(page.limit)
    .offset(page.offset);

  const countRow = one(
    await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(eq(memberships.schoolId, schoolId)),
  );

  return { rows, total: countRow.count };
}

// ── Role resolution + permission loading ──────────────────────────

/**
 * Resolve an array of role keys to their rows, scoped to the school.
 * Returns fewer rows than keys.length if some keys don't exist in this
 * school — the caller (service) checks that and throws 400.
 *
 * This is the "role keys are per-school" enforcement: "teacher" is a
 * legitimate key at School A but returns nothing at School B unless
 * that school has a "teacher" role (which it does, from DEFAULT_ROLES,
 * but a future custom role would only exist where it was created).
 */
export async function findRolesByKeys(
  executor: DbExecutor,
  schoolId: string,
  keys: string[],
): Promise<Role[]> {
  if (keys.length === 0) return [];
  return executor
    .select()
    .from(roles)
    .where(and(eq(roles.schoolId, schoolId), inArray(roles.key, keys)));
}

/**
 * Load the permissions granted to each of the given roles.
 * Returns a map: roleId → Permission[].
 * One query (not one per role), then grouped in JS.
 *
 * Used by createUser to enforce "you can only assign a role whose
 * permissions you hold" — for each role being assigned, check
 * canAssignRole(actor, { rank: role.rank, permissions: perms[role.id] }).
 */
export async function loadRolePermissions(
  executor: DbExecutor,
  roleIds: string[],
): Promise<Record<string, Permission[]>> {
  if (roleIds.length === 0) return {};

  const rows = await executor
    .select({
      roleId: rolePermissions.roleId,
      permission: rolePermissions.permission,
    })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, roleIds));

  const byRole: Record<string, Permission[]> = {};
  for (const row of rows) {
    (byRole[row.roleId] ??= []).push(row.permission as Permission);
  }
  return byRole;
}

// ── User lookup + creation ─────────────────────────────────────────

/**
 * Look up a user by email (case-insensitive). Users are global — one email,
 * one user row, regardless of how many schools they belong to.
 *
 * NOTE: modules/auth/repository.ts has an identical function for login.
 * Duplicated here for module independence. If the query changes, change
 * both — or consolidate later by making auth import from users.
 */
export async function findUserByEmail(
  executor: DbExecutor,
  email: string,
): Promise<User | null> {
  const [user] = await executor
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
  return user ?? null;
}

/**
 * Insert a new user row.
 * For the createUser flow, this is only called when no user with that email
 * exists. The caller (service) has already hashed the temp password.
 */
export async function insertUser(
  executor: DbExecutor,
  data: {
    email: string | null;
    passwordHash: string;
    firstName: string;
    lastName: string;
    mustChangePassword: boolean;
  },
): Promise<User> {
  return one(
    await executor
      .insert(users)
      .values({
        email: data.email,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        mustChangePassword: data.mustChangePassword,
      })
      .returning(),
  );
}

// ── Membership creation ────────────────────────────────────────────

/**
 * Create a membership linking a user to a school.
 * Two unique constraints can fire:
 *   - memberships_school_user_uq     → user is already a member of this school
 *   - memberships_school_username_uq → username is taken within this school
 * Both are user-caused → 409 with distinct error codes for the frontend.
 */
export async function createMembership(
  executor: DbExecutor,
  data: {
    userId: string;
    schoolId: string;
    username: string | null;
    status?: "active" | "inactive" | "suspended";
  },
): Promise<Membership> {
  try {
    return one(
      await executor
        .insert(memberships)
        .values({
          userId: data.userId,
          schoolId: data.schoolId,
          username: data.username,
          status: data.status ?? "active",
        })
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err, "memberships_school_user_uq")) {
      throw new AppError(
        409,
        "ALREADY_MEMBER",
        "This user is already a member of this school",
      );
    }
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

// ── Role assignment ────────────────────────────────────────────────

/**
 * Assign one or more roles to a membership, in this school, recorded as
 * assigned by the actor. Bulk insert — one round-trip for N roles.
 *
 * `.onConflictDoNothing()` on the composite PK (membershipId, roleId):
 * if a role is already assigned (duplicate in the input, or a re-apply),
 * skip silently. Idempotent — makes retries safe.
 */
export async function insertMembershipRoles(
  executor: DbExecutor,
  data: {
    membershipId: string;
    schoolId: string;
    roleIds: string[];
    assignedBy: string;
  },
): Promise<void> {
  if (data.roleIds.length === 0) return;

  await executor
    .insert(membershipRoles)
    .values(
      data.roleIds.map((roleId) => ({
        membershipId: data.membershipId,
        roleId,
        schoolId: data.schoolId,
        assignedBy: data.assignedBy,
      })),
    )
    .onConflictDoNothing();
}
