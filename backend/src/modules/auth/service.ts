// modules/auth/service.ts
import { and, eq } from "drizzle-orm";
import type { DbExecutor, Tx } from "../../db/types.js";
import { memberships, users } from "../../db/schema/index.js";
import { one } from "../../shared/utils/assert.js";
import { AppError } from "../../shared/lib/errors.js";
import {
  getDummyHash,
  hashPassword,
  verifyPassword,
} from "../../shared/utils/password.js";
import { createSession, revokeAllUserSessions } from "./session.js";
import { recordAudit } from "../../shared/audit/record.js";
import { isUniqueViolation } from "../../shared/errors/pg-errors.js";
import { normalizeEmail } from "../../shared/utils/normalize.js";
import { listLoginMemberships, touchLastLogin } from "./repository.js";
import { findUserById } from "./repository.js";
import { findUserByEmail } from "../users/repository.js";
import { findSchoolBySlug, findMembershipByUsername } from "./repository.js";
import type { Actor } from "../rbac/can.js";
import type { LoginInput } from "./schema.js";

export type LoginResult =
  | {
      kind: "success";
      token: string;
      userId: string;
      membershipId: string;
      schoolId: string;
    }
  | {
      kind: "select_school";
      schools: Array<{ slug: string; name: string }>;
    };

interface LoginContext {
  userAgent?: string | undefined;
  ipAddress?: string | undefined;
  log?:
    { warn: (obj: Record<string, unknown>, msg: string) => void } | undefined;
}

interface SessionMembership {
  id: string;
  schoolId: string;
}

// ── Shared helpers ───────────────────────────────────────────────────

/**
 * Log the failure (anonymized identifier + IP) and throw the ONE error body
 * every credential failure returns. Never leaks which field was wrong.
 */
function logAndThrowInvalid(
  context: LoginContext,
  identifierHint: string,
): never {
  context.log?.warn(
    { identifier: identifierHint, ip: context.ipAddress },
    "login_failed",
  );
  throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
}

/** Anonymize an identifier for logging: first 3 chars + stars. */
function hint(s: string): string {
  return s.slice(0, 3) + "***";
}

async function createLoginSession(
  db: DbExecutor,
  user: { id: string },
  membership: SessionMembership,
  context: LoginContext,
): Promise<LoginResult> {
  const token = await db.transaction(async (tx) => {
    const token = await createSession(tx, user.id, membership.id, {
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });
    await touchLastLogin(tx, user.id);
    await recordAudit(tx, {
      schoolId: membership.schoolId,
      actorMembershipId: membership.id,
      action: "auth.login_succeeded",
      targetType: "user",
      targetId: user.id,
      metadata: { ip: context.ipAddress, userAgent: context.userAgent },
    });
    return token;
  });

  return {
    kind: "success",
    token,
    userId: user.id,
    membershipId: membership.id,
    schoolId: membership.schoolId,
  };
}
/**
 * Self-service password change. Requires the CURRENT password, not just
 * a session. This is the endpoint that closes the "stolen session cookie"
 * hole — a thief with a cookie cannot change the password because they
 * don't know the current one.
 *
 * On success:
 *  - Password is updated
 *  - mustChangePassword is cleared
 *  - All OTHER sessions are revoked (the current session stays valid)
 */
export async function changePassword(
  tx: Tx,
  actor: Actor,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const userId = actor.userId;
  const user = one(await tx.select().from(users).where(eq(users.id, userId)));

  if (!user.passwordHash) {
    throw new AppError(
      400,
      "NO_PASSWORD",
      "Your account does not have a password set. Contact your admin.",
    );
  }

  const valid = await verifyPassword(user.passwordHash, currentPassword);
  if (!valid) {
    throw new AppError(
      401,
      "INVALID_PASSWORD",
      "Current password is incorrect",
    );
  }

  const newHash = await hashPassword(newPassword);
  await tx
    .update(users)
    .set({ passwordHash: newHash, mustChangePassword: false })
    .where(eq(users.id, userId));

  // Revoke all sessions except the current one
  await revokeAllUserSessions(tx, userId, currentSessionId);

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId, // no target membership — this is a self-service action
    action: "user.password_changed",
    targetType: "user",
    targetId: userId,
    metadata: { via: "self_service" },
  });
}

async function loginByEmail(
  db: DbExecutor,
  input: LoginInput,
  context: LoginContext,
): Promise<LoginResult> {
  // Zod guarantees exactly one identifier; defensive against non-Zod callers.
  if (!input.email) {
    await verifyPassword(getDummyHash(), input.password);
    logAndThrowInvalid(context, "<missing-email>");
  }

  const email = normalizeEmail(input.email);
  const user = await findUserByEmail(db, email);
  const hashToCheck = user?.passwordHash ?? getDummyHash();
  const passwordOk = await verifyPassword(hashToCheck, input.password);

  if (!user || !user.passwordHash || !passwordOk || user.status !== "active") {
    logAndThrowInvalid(context, hint(email));
  }

  const memberships = await listLoginMemberships(db, user.id);
  if (memberships.length === 0) {
    logAndThrowInvalid(context, hint(email));
  }

  let membership: SessionMembership;
  if (input.schoolSlug) {
    const found = memberships.find((m) => m.schoolSlug === input.schoolSlug);
    if (!found) {
      logAndThrowInvalid(context, hint(email));
    }
    membership = found;
  } else if (memberships.length === 1) {
    membership = memberships[0]!;
  } else {
    // Multiple memberships, no slug chosen → picker response, no session.
    return {
      kind: "select_school",
      schools: memberships.map((m) => ({
        slug: m.schoolSlug,
        name: m.schoolName,
      })),
    };
  }

  return createLoginSession(db, user, membership, context);
}

// ── Username path (new) ──────────────────────────────────────────────

async function loginByUsername(
  db: DbExecutor,
  input: LoginInput,
  context: LoginContext,
): Promise<LoginResult> {
  const username = input.username!.trim().toLowerCase();
  const schoolSlug = input.schoolSlug?.trim().toLowerCase();

  // Zod enforces "schoolSlug required when username is present", but
  // if this function is ever called from outside Zod, be defensive.
  // A missing slug is a bad request — but per the brief, it must still
  // look like a credential failure (same status, code, message, timing).
  if (!schoolSlug) {
    await verifyPassword(getDummyHash(), input.password);
    logAndThrowInvalid(context, hint(username));
  }

  // School lookup — findSchoolBySlug filters status = 'active', so a
  // suspended school returns null, indistinguishable from "no such slug."
  const school = await findSchoolBySlug(db, schoolSlug);

  if (!school) {
    await verifyPassword(getDummyHash(), input.password);
    logAndThrowInvalid(context, hint(username));
  }

  const membership = await findMembershipByUsername(db, school.id, username);

  if (!membership) {
    await verifyPassword(getDummyHash(), input.password);
    logAndThrowInvalid(context, hint(username));
  }
  const user = await findUserById(db, membership.userId);
  if (!user || !user.passwordHash) {
    await verifyPassword(getDummyHash(), input.password);
    logAndThrowInvalid(context, hint(username));
  }
  // Always verify — even when the user lookup failed, use the dummy hash.
  // This burns the same CPU as a real verify, so "unknown school",
  // "unknown username", and "wrong password" are timing-indistinguishable.
  const hashToCheck = user?.passwordHash ?? getDummyHash();
  const passwordOk = await verifyPassword(hashToCheck, input.password);
  if (
    !passwordOk ||
    user.status !== "active" ||
    membership.status !== "active"
  ) {
    logAndThrowInvalid(context, hint(username));
  }

  // Username login carries the school — no select_school step.
  return createLoginSession(db, user, membership, context);
}

// ── Public entry — branches by identifier ────────────────────────────

export async function login(
  db: DbExecutor,
  input: LoginInput,
  context: LoginContext,
): Promise<LoginResult> {
  if (input.username !== undefined) {
    return loginByUsername(db, input, context);
  }
  return loginByEmail(db, input, context);
}


/**
 * Self-service username change. The current password is required so a stolen
 * session cookie cannot redirect the account's login handle.
 */
export async function changeUsername(
  tx: Tx,
  actor: Actor,
  currentSessionId: string,
  currentPassword: string,
  newUsername: string,
): Promise<void> {
  const user = one(await tx.select().from(users).where(eq(users.id, actor.userId)));
  if (!user.passwordHash) {
    throw new AppError(400, "NO_PASSWORD", "Your account does not have a password set.");
  }
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError(401, "INVALID_PASSWORD", "Current password is incorrect");
  }

  const current = one(
    await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.id, actor.membershipId),
          eq(memberships.schoolId, actor.schoolId),
        ),
      ),
  );
  if (current.username === newUsername) {
    throw new AppError(400, "SAME_USERNAME", "That is already your username");
  }

  try {
    await tx
      .update(memberships)
      .set({ username: newUsername })
      .where(eq(memberships.id, actor.membershipId));
  } catch (err) {
    if (isUniqueViolation(err, "memberships_school_username_uq")) {
      throw new AppError(409, "USERNAME_TAKEN", "That username is already in use at this school");
    }
    throw err;
  }

  // A login-handle change invalidates all other sessions.
  await revokeAllUserSessions(tx, actor.userId, currentSessionId);

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "membership.username_changed",
    targetType: "membership",
    targetId: actor.membershipId,
    before: { username: current.username },
    after: { username: newUsername },
    metadata: { via: "self_service" },
  });
}
