import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor, Tx } from "../../../db/types.js";
import { can, type Actor } from "../../rbac/can.js";
import { AppError } from "../../../shared/lib/errors.js";
import { isUniqueViolation } from "../../../shared/errors/pg-errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { one } from "../../../shared/utils/assert.js";
import {
  schools,
  academicSessions,
  terms,
  type Term,
} from "../../../db/schema/index.js";
import { canTransitionTerm, type TermStatus } from "./transitions.js";
import { isRealCalendarDate, type CreateTermInput, type UpdateTermInput } from "./schema.js";

/**
 * Serialize every calendar mutation for one school.
 *
 * All four operations (activate, close, lock, unlock) take this lock first,
 * so they cannot interleave with each other. The lock is held until the
 * transaction commits or rolls back.
 */
async function lockSchool(tx: Tx, schoolId: string): Promise<void> {
  await tx
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .for("update");
}

/**
 * Lock the academic-session row for term creation/editing. Callers hold the
 * school lock first, so calendar mutations serialize in one order:
 * school → session → term.
 */
async function lockSessionRow(
  tx: Tx,
  schoolId: string,
  sessionId: string,
): Promise<typeof academicSessions.$inferSelect> {
  const [session] = await tx
    .select()
    .from(academicSessions)
    .where(
      and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, schoolId),
      ),
    )
    .for("update");
  if (!session) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "Academic session not found in this school",
    );
  }
  return session;
}

// ── Activate a term ────────────────────────────────────────────────
//
// Activating the next term is allowed to close the currently active term in
// the same transaction, but it requires explicit confirmation. Rules:
//   1. confirm must be true (closing the active term is a side effect).
//   2. The target term must be planned and its session unlocked.
//   3. Term N > 1 requires term N-1 to exist and be closed.
//   4. Any currently active term is closed first, then the target activates.
//   5. The one-active partial unique index is the final backstop.
//
// The school-row lock serializes all calendar mutations for a school.
export async function activateTerm(
  tx: Tx,
  actor: Actor,
  termId: string,
  confirm: boolean,
): Promise<void> {
  if (!can(actor, "calendar:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot activate a term");
  }
  if (confirm !== true) {
    throw new AppError(
      400,
      "CONFIRMATION_REQUIRED",
      "Activating a term requires explicit confirmation (confirm: true)",
    );
  }

  await lockSchool(tx, actor.schoolId);

  const [term] = await tx
    .select()
    .from(terms)
    .where(and(eq(terms.id, termId), eq(terms.schoolId, actor.schoolId)));
  if (!term) {
    throw new AppError(404, "NOT_FOUND", "Term not found in this school");
  }

  const session = one(
    await tx
      .select()
      .from(academicSessions)
      .where(eq(academicSessions.id, term.sessionId)),
  );
  if (session.closedAt !== null) {
    throw new AppError(
      409,
      "SESSION_LOCKED",
      "The academic session is locked. Unlock it first.",
    );
  }

  if (term.status === "active") {
    throw new AppError(
      409,
      "TERM_ALREADY_ACTIVE",
      "This term is already active",
    );
  }
  if (!canTransitionTerm(term.status as TermStatus, "active")) {
    throw new AppError(
      409,
      "INVALID_TRANSITION",
      `Cannot activate a term with status '${term.status}'`,
    );
  }

  // Close the school's current teaching term, if any, in this transaction.
  const [current] = await tx
    .select()
    .from(terms)
    .where(and(eq(terms.schoolId, actor.schoolId), eq(terms.status, "active")))
    .limit(1);
  if (current && current.id !== term.id) {
    await tx
      .update(terms)
      .set({ status: "closed" })
      .where(eq(terms.id, current.id));
    await recordAudit(tx, {
      schoolId: actor.schoolId,
      actorMembershipId: actor.membershipId,
      action: "term.closed",
      targetType: "term",
      targetId: current.id,
      before: { status: "active" },
      after: { status: "closed" },
      metadata: { via: "activation", activatedTermId: term.id },
    });
  }

  if (term.number > 1) {
    const previous = await tx
      .select({ id: terms.id, status: terms.status })
      .from(terms)
      .where(
        and(
          eq(terms.sessionId, term.sessionId),
          eq(terms.number, term.number - 1),
        ),
      );
    if (previous.length === 0) {
      throw new AppError(
        400,
        "TERM_SEQUENCE_BROKEN",
        `Term ${term.number - 1} does not exist in this session`,
      );
    }
    if (previous[0]!.status !== "closed") {
      throw new AppError(
        409,
        "TERM_NOT_SEQUENTIAL",
        `Term ${term.number - 1} must be closed before term ${term.number} can activate`,
      );
    }
  }

  try {
    await tx.update(terms).set({ status: "active" }).where(eq(terms.id, termId));
  } catch (err) {
    if (isUniqueViolation(err, "terms_one_active_per_school")) {
      throw new AppError(
        409,
        "TERM_ALREADY_ACTIVE",
        "Another term is already active in this school",
      );
    }
    throw err;
  }

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "term.activated",
    targetType: "term",
    targetId: term.id,
    before: { status: term.status },
    after: { status: "active" },
  });
}

// ── Close a term ───────────────────────────────────────────────────
//
// Requires explicit `confirm: true` (validated at the route, also checked
// here for defence in depth). Transition must be active → closed.
export async function closeTerm(
  tx: Tx,
  actor: Actor,
  termId: string,
  confirm: boolean,
): Promise<void> {
  if (!can(actor, "calendar:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot close a term");
  }

  await lockSchool(tx, actor.schoolId);

  const [term] = await tx
    .select()
    .from(terms)
    .where(and(eq(terms.id, termId), eq(terms.schoolId, actor.schoolId)));
  if (!term) {
    throw new AppError(404, "NOT_FOUND", "Term not found in this school");
  }

  if (confirm !== true) {
    throw new AppError(
      400,
      "CONFIRMATION_REQUIRED",
      "Closing a term requires explicit confirmation (confirm: true)",
    );
  }

  if (!canTransitionTerm(term.status as TermStatus, "closed")) {
    throw new AppError(
      409,
      "INVALID_TRANSITION",
      `Cannot close a term with status '${term.status}'`,
    );
  }

  await tx.update(terms).set({ status: "closed" }).where(eq(terms.id, termId));

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "term.closed",
    targetType: "term",
    targetId: term.id,
    before: { status: term.status },
    after: { status: "closed" },
  });
}

// ── Lock a session (the year is done) ─────────────────────────────
//
// Precondition: every term in the session has status = 'closed'.
// The lock is `closed_at = now()`. It gates new session-scoped writes;
// it does not change any term's status.
export async function lockSession(
  tx: Tx,
  actor: Actor,
  sessionId: string,
): Promise<void> {
  if (!can(actor, "calendar:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot lock a session");
  }

  await lockSchool(tx, actor.schoolId);

  const [session] = await tx
    .select()
    .from(academicSessions)
    .where(
      and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, actor.schoolId),
      ),
    )
    .for("update");
  if (!session) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "Academic session not found in this school",
    );
  }

  if (session.closedAt !== null) {
    throw new AppError(409, "SESSION_ALREADY_LOCKED", "Session is already locked");
  }

  const openCount = one(
    await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(terms)
      .where(
        and(eq(terms.sessionId, sessionId), sql`${terms.status} != 'closed'`),
      ),
  );

  if (openCount.count > 0) {
    throw new AppError(
      409,
      "SESSION_HAS_OPEN_TERMS",
      `${openCount.count} term(s) must be closed before locking the session`,
    );
  }

  const closedAt = new Date();
  await tx
    .update(academicSessions)
    .set({ closedAt })
    .where(eq(academicSessions.id, sessionId));

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "academic_year.closed",
    targetType: "academic_session",
    targetId: sessionId,
    before: { closedAt: null },
    after: { closedAt: closedAt.toISOString() },
  });
}

// ── Unlock a session (reason required) ───────────────────────────
//
// Does NOT reopen any term. Terms stay at their current status.
// Only re-enables new session-scoped writes.
export async function unlockSession(
  tx: Tx,
  actor: Actor,
  sessionId: string,
  reason: string,
): Promise<void> {
  if (!can(actor, "calendar:unlock")) {
    throw new AppError(403, "FORBIDDEN", "Cannot unlock a session");
  }

  await lockSchool(tx, actor.schoolId);

  const [session] = await tx
    .select()
    .from(academicSessions)
    .where(
      and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, actor.schoolId),
      ),
    )
    .for("update");
  if (!session) {
    throw new AppError(
      404,
      "NOT_FOUND",
      "Academic session not found in this school",
    );
  }

  if (session.closedAt === null) {
    throw new AppError(409, "SESSION_NOT_LOCKED", "Session is not locked");
  }

  await tx
    .update(academicSessions)
    .set({ closedAt: null })
    .where(eq(academicSessions.id, sessionId));

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "academic_year.reopened",
    targetType: "academic_session",
    targetId: sessionId,
    before: { closedAt: session.closedAt.toISOString() },
    after: { closedAt: null },
    metadata: { reason },
  });
}

// ── Overlap check for term creation/editing ──────────────────────
//
// MUST be called while holding SELECT ... FOR UPDATE on the academic
// session row. Otherwise two concurrent creates could each pass the
// check and both commit.
//
// Postgres's `daterange(..., '[]') && daterange(...)` is the inclusive
// overlap operator. Two terms whose ranges share even one day overlap.
export async function checkTermsDoNotOverlap(
  tx: Tx,
  schoolId: string,
  sessionId: string,
  startDate: string,
  endDate: string,
  excludeTermId?: string,
): Promise<void> {
  const overlaps = await tx
    .select({ id: terms.id, name: terms.name })
    .from(terms)
    .where(
      and(
        eq(terms.schoolId, schoolId),
        eq(terms.sessionId, sessionId),
        excludeTermId ? sql`${terms.id} != ${excludeTermId}` : undefined,
        sql`daterange(${terms.startDate}, ${terms.endDate}, '[]') && daterange(${startDate}::date, ${endDate}::date, '[]')`,
      ),
    );

  if (overlaps.length > 0) {
    throw new AppError(
      409,
      "TERM_DATES_OVERLAP",
      `Dates overlap with existing term "${overlaps[0]!.name}"`,
    );
  }
}

// ── Create / edit terms ────────────────────────────────────────────
//
// Both operations take the school lock, then the session row lock, then run
// the overlap check. That ordering serializes them with activation/lock and
// makes the overlap check race-free.

export async function createTerm(
  tx: Tx,
  actor: Actor,
  input: CreateTermInput,
): Promise<Term> {
  if (!can(actor, "calendar:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot create a term");
  }
  if (
    !isRealCalendarDate(input.startDate) ||
    !isRealCalendarDate(input.endDate) ||
    input.endDate < input.startDate
  ) {
    throw new AppError(
      400,
      "INVALID_DATES",
      "Dates must be real calendar dates with endDate on or after startDate",
    );
  }

  await lockSchool(tx, actor.schoolId);
  const session = await lockSessionRow(tx, actor.schoolId, input.sessionId);
  if (session.closedAt !== null) {
    throw new AppError(
      409,
      "SESSION_LOCKED",
      "Cannot add terms to a locked session",
    );
  }

  await checkTermsDoNotOverlap(
    tx,
    actor.schoolId,
    input.sessionId,
    input.startDate,
    input.endDate,
  );

  let created: Term;
  try {
    created = one(
      await tx
        .insert(terms)
        .values({
          schoolId: actor.schoolId,
          sessionId: input.sessionId,
          number: input.number,
          name: input.name.trim(),
          startDate: input.startDate,
          endDate: input.endDate,
          status: "planned",
        })
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err, "terms_session_number_uq")) {
      throw new AppError(
        409,
        "TERM_NUMBER_TAKEN",
        `Term number ${input.number} already exists in this session`,
      );
    }
    throw err;
  }

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "term.created",
    targetType: "term",
    targetId: created.id,
    after: {
      sessionId: created.sessionId,
      number: created.number,
      name: created.name,
      startDate: created.startDate,
      endDate: created.endDate,
      status: created.status,
    },
  });

  return created;
}

export async function updateTerm(
  tx: Tx,
  actor: Actor,
  termId: string,
  input: UpdateTermInput,
): Promise<Term> {
  if (!can(actor, "calendar:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot update a term");
  }

  await lockSchool(tx, actor.schoolId);

  const [existing] = await tx
    .select()
    .from(terms)
    .where(and(eq(terms.id, termId), eq(terms.schoolId, actor.schoolId)))
    .for("update");
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Term not found in this school");
  }

  const session = await lockSessionRow(
    tx,
    actor.schoolId,
    existing.sessionId,
  );
  if (session.closedAt !== null) {
    throw new AppError(
      409,
      "SESSION_LOCKED",
      "Cannot edit terms in a locked session",
    );
  }

  const patch: {
    name?: string;
    startDate?: string;
    endDate?: string;
  } = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  if (Object.keys(patch).length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", "no fields to update");
  }

  const startDate = patch.startDate ?? existing.startDate;
  const endDate = patch.endDate ?? existing.endDate;
  if (
    !isRealCalendarDate(startDate) ||
    !isRealCalendarDate(endDate) ||
    endDate < startDate
  ) {
    throw new AppError(
      400,
      "INVALID_DATES",
      "Dates must be real calendar dates with endDate on or after startDate",
    );
  }

  if (patch.startDate !== undefined || patch.endDate !== undefined) {
    await checkTermsDoNotOverlap(
      tx,
      actor.schoolId,
      existing.sessionId,
      startDate,
      endDate,
      existing.id,
    );
  }

  const [updated] = await tx
    .update(terms)
    .set(patch)
    .where(eq(terms.id, termId))
    .returning();
  if (!updated) {
    throw new AppError(404, "NOT_FOUND", "Term not found in this school");
  }

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "term.updated",
    targetType: "term",
    targetId: updated.id,
    before: {
      name: existing.name,
      startDate: existing.startDate,
      endDate: existing.endDate,
    },
    after: {
      name: updated.name,
      startDate: updated.startDate,
      endDate: updated.endDate,
    },
  });

  return updated;
}
export async function listTerms(
  executor: DbExecutor,
  actor: Actor,
  sessionId: string,
): Promise<Term[]> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list terms");
  }
  return executor
    .select()
    .from(terms)
    .where(
      and(eq(terms.schoolId, actor.schoolId), eq(terms.sessionId, sessionId)),
    )
    .orderBy(terms.number);
}
