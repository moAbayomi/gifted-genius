import { and, eq } from "drizzle-orm";
import {
  academicSessions,
  type AcademicSession,
} from "../../db/schema/academic-sessions.js";
import type { Tx } from "../../db/types.js";
import { AppError } from "../../shared/lib/errors.js";

/**
 * Load a session by (schoolId, sessionId) with a FOR SHARE lock, and refuse
 * if it is not open.
 *
 * MUST be called inside a transaction (`tx: Tx`, not `DbExecutor`). The
 * share lock is held until the enclosing transaction commits or rolls back,
 * which prevents `lockSession` (which takes FOR UPDATE on the same row) from
 * closing the session while the current transaction is in flight.
 *
 * Returns the session row so callers can read `id` / `label` / `closedAt`
 * without a second query.
 *
 * Throws:
 *   - 404 SESSION_NOT_FOUND when the session does not exist in this school.
 *     Cross-school session IDs also land here — no id-probing leak.
 *   - 409 SESSION_LOCKED when the session's `closed_at` is set.
 */
export async function assertSessionOpen(
  tx: Tx,
  schoolId: string,
  sessionId: string,
): Promise<AcademicSession> {
  const [row] = await tx
    .select()
    .from(academicSessions)
    .where(
      and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, schoolId),
      ),
    )
    .for("share")
    .limit(1);

  if (!row) {
    throw new AppError(
      404,
      "SESSION_NOT_FOUND",
      "Session not found in this school",
    );
  }
  if (row.closedAt !== null) {
    throw new AppError(409, "SESSION_LOCKED", "Session is locked");
  }
  return row;
}