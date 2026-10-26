// modules/auth/service.ts
import { eq } from "drizzle-orm";
import type { DbExecutor, Tx } from "../../db/types.js";
import { users } from "../../db/schema/index.js";
import { one } from "../../shared/utils/assert.js";
import { AppError } from "../../shared/lib/errors.js";
import {
  getDummyHash,
  hashPassword,
  verifyPassword,
} from "../../shared/utils/password.js";
import { createSession, revokeAllUserSessions } from "./session.js";
import { recordAudit } from "../../shared/audit/record.js";
import { normalizeEmail } from "../../shared/utils/normalize.js";
import {
  listLoginMemberships,
  touchLastLogin,
} from "./repository.js";
import { findUserByEmail } from "../users/repository.js";
import type { Actor } from "../rbac/can.js";

export type LoginInput = {
  email?: string;
  password: string;
  schoolSlug?: string | undefined; // for multi-membership flow
};

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

  const userId = actor.userId
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

export async function login(
  db: DbExecutor,
  input: LoginInput,
  context: {
    userAgent?: string | undefined;
    ipAddress?: string | undefined;
    log?:
      { warn: (obj: Record<string, unknown>, msg: string) => void } | undefined;
  },
): Promise<LoginResult> {
  // ... the 8 steps
  const email = normalizeEmail(input.email!);
  const user = await findUserByEmail(db, email);
  const hashToCheck = user?.passwordHash ?? getDummyHash();
  const passwordOk = await verifyPassword(hashToCheck, input.password);

  if (!user || !user.passwordHash || !passwordOk || user.status != "active") {
    context.log?.warn(
      { identifier: email.slice(0, 3) + "***", ip: context.ipAddress },
      "login_failed",
    );
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const memberships = await listLoginMemberships(db, user.id);
  if (memberships.length === 0) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  let membership;
  if (input.schoolSlug) {
    const found = memberships.find((m) => m.schoolSlug === input.schoolSlug);
    if (!found) {
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }
    membership = found;
  } else if (memberships.length === 1) {
    membership = memberships[0]!;
  } else {
    // Multiple — return the picker, no session
    return {
      kind: "select_school",
      schools: memberships.map((m) => ({
        slug: m.schoolSlug,
        name: m.schoolName,
      })),
    };
  }

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
