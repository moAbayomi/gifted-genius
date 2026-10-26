import { and, eq, ne, sql } from "drizzle-orm";
import { users, type User } from "../../db/schema/users.js";
import type { DbExecutor } from "../../db/types.js";
import { memberships, type Membership } from "../../db/schema/memberships.js";
import { schools, type School } from "../../db/schema/schools.js";
import { sessions } from "../../db/schema/sessions.js";

export interface LiveSession {
  sessionId: string;
  userId: string;
  membershipId: string;
  schoolId: string;
  mustChangePassword: boolean;
}


export async function findUserById(
  executor: DbExecutor,
  userId: string,
): Promise<User | null> {
  const [user] = await executor
    .select()
    .from(users)
    .where(eq(users.id, userId));
  return user ?? null;
}

export async function findSchoolById(
  executor: DbExecutor,
  schoolId: string,
): Promise<School | null> {
  const [school] = await executor
    .select()
    .from(schools)
    .where(eq(schools.id, schoolId));
  return school ?? null;
}

export async function findMembershipByUsername(
  executor: DbExecutor,
  schoolId: string,
  username: string,
): Promise<Membership | null> {
  const [membership] = await executor
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.schoolId, schoolId),
        eq(memberships.username, username),
      ),
    );

  return membership ?? null;
}

export async function listLoginMemberships(
  executor: DbExecutor,
  userId: string,
): Promise<Array<Membership & { schoolName: string; schoolSlug: string }>> {
  const active = await executor
    .select({
      id: memberships.id,
      userId: memberships.userId,
      schoolId: memberships.schoolId,
      username: memberships.username,
      status: memberships.status,
      joinedAt: memberships.joinedAt,
      createdAt: memberships.createdAt,
      updatedAt: memberships.updatedAt,
      schoolName: schools.name,
      schoolSlug: schools.slug,
    })
    .from(memberships)
    .innerJoin(schools, eq(schools.id, memberships.schoolId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        eq(schools.status, "active"),
        eq(users.status, "active"),
      ),
    );
  return active;
}

export async function findMembershipByUserAndSchool(
  executor: DbExecutor,
  userId: string,
  schoolId: string,
): Promise<Membership | null> {
  const [membership] = await executor
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.schoolId, schoolId)),
    );
  return membership ?? null;
}

export async function findLiveSession(
  executor: DbExecutor,
  tokenHash: string,
): Promise<LiveSession | null> {
  const [row] = await executor
    .select({
      sessionId: sessions.id, // ← add this
      userId: users.id,
      membershipId: memberships.id,
      schoolId: schools.id,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(memberships, eq(memberships.id, sessions.activeMembershipId))
    .innerJoin(schools, eq(schools.id, memberships.schoolId))
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        sql`${sessions.expiresAt} > now()`,
        eq(memberships.status, "active"),
        eq(users.status, "active"),
        eq(schools.status, "active"),
      ),
    );

  return row ?? null;
}

export async function deleteSession(
  executor: DbExecutor,
  sessionId: string,
): Promise<void> {
  await executor.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteSessionsForUser(
  executor: DbExecutor,
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  if (exceptSessionId) {
    await executor
      .delete(sessions)
      .where(
        and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)),
      );
  } else {
    await executor.delete(sessions).where(eq(sessions.userId, userId));
  }
}

export async function deleteSessionsForMembership(
  executor: DbExecutor,
  membershipId: string,
): Promise<void> {
  await executor
    .delete(sessions)
    .where(eq(sessions.activeMembershipId, membershipId));
}

export async function touchLastLogin(
  executor: DbExecutor,
  userId: string,
): Promise<void> {
  await executor
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, userId));
}
