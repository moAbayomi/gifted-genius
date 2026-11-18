// modules/auth/session.ts
import { createHash, randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import { sessions } from "../../db/schema/index.js";
import env from "../../config/env.js";

export interface SessionRow {
  id: string;
  userId: string;
  activeMembershipId: string;
  expiresAt: Date;
  createdAt: Date;
}


/** SHA-256 of a token. Deterministic so we can look it up by hash. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Generate a new session token.
 * The raw token goes in the cookie; only the hash is stored in the DB.
 * If the DB is ever compromised, the stored hashes are useless to an attacker.
 */
export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/**
 * Create a session row for a logged-in user at a specific membership.
 * Returns the RAW token — the caller sets it in a cookie. The DB only
 * ever sees the hash.
 */
export async function createSession(
  executor: DbExecutor,
  userId: string,
  activeMembershipId: string,
  context: { userAgent?: string | undefined; ipAddress?: string | undefined } = {},
): Promise<string> {
  const { token, tokenHash } = generateSessionToken();
  const expiresAt = new Date(
    Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await executor.insert(sessions).values({
    tokenHash,
    userId,
    activeMembershipId,
    expiresAt,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
  });

  return token;
}

/**
 * Look up a session by the RAW token from the cookie.
 * Hashes the token, queries by hash, and returns null if:
 *   - No session with that hash (revoked or never existed)
 *   - Session has expired
 *
 * Returns the session row on success. Callers still need to load the
 * user and membership separately — this function doesn't.
 */
export async function findSessionByToken(
  executor: DbExecutor,
  rawToken: string,
): Promise<SessionRow | null> {
  const tokenHash = hashToken(rawToken);

  const rows = await executor
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash));

  if (rows.length === 0) return null;

  const session = rows[0]!;

  // Expired sessions are treated as absent. Cleanup job handles physical deletion.
  if (session.expiresAt.getTime() < Date.now()) return null;

  return {
    id: session.id,
    userId: session.userId,
    activeMembershipId: session.activeMembershipId,
    expiresAt: session.expiresAt,
    createdAt: session.createdAt,
  };
}

/**
 * Delete a session by its raw token (used by logout).
 * Idempotent — returns silently if the session doesn't exist.
 */
export async function revokeSession(
  executor: DbExecutor,
  rawToken: string,
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await executor.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

/**
 * Delete all sessions for a user (password change, "sign out everywhere",
 * suspension). Does not include the current session — callers that want
 * to keep the current one pass `exceptSessionId`.
 */
export async function revokeAllUserSessions(
  executor: DbExecutor,
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  const userSessions = await executor
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  const toDelete = userSessions
    .map((s) => s.id)
    .filter((id) => id !== exceptSessionId);

  if (toDelete.length === 0) return;

  await executor.delete(sessions).where(inArray(sessions.id, toDelete));
}
