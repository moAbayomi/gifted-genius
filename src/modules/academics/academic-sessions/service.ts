import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor, Tx } from "../../../db/types.js";
import type { Actor } from "../../rbac/can.js";
import { can } from "../../rbac/can.js";
import { AppError } from "../../../shared/lib/errors.js";
import { isUniqueViolation } from "../../../shared/errors/pg-errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import {
  academicSessions,
  terms,
  type AcademicSession,
} from "../../../db/schema/index.js";

/**
 * A session label is `YYYY/YYYY`; the second year must be exactly the first
 * plus one. The database regex only checks the shape, so this is a service
 * rule.
 */
export function parseSessionLabel(label: string): {
  startYear: number;
  endYear: number;
} {
  const match = /^([0-9]{4})\/([0-9]{4})$/.exec(label.trim());
  if (!match) {
    throw new AppError(
      400,
      "INVALID_SESSION_LABEL",
      "Session label must be YYYY/YYYY",
    );
  }
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) {
    throw new AppError(
      400,
      "INVALID_SESSION_LABEL",
      "The second year must be the first year plus one",
    );
  }
  return { startYear, endYear };
}

function translateUnique(err: unknown, label: string): never {
  if (isUniqueViolation(err, "academic_sessions_school_label_uq")) {
    throw new AppError(
      409,
      "SESSION_LABEL_TAKEN",
      `A session labelled "${label}" already exists at this school`,
    );
  }
  throw err;
}

export async function createAcademicSession(
  tx: Tx,
  actor: Actor,
  label: string,
): Promise<AcademicSession> {
  if (!can(actor, "calendar:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot create an academic session");
  }

  const trimmed = label.trim();
  parseSessionLabel(trimmed);

  let created: AcademicSession;
  try {
    const [row] = await tx
      .insert(academicSessions)
      .values({ schoolId: actor.schoolId, label: trimmed })
      .returning();
    if (!row) throw new Error("session insert returned no row");
    created = row;
  } catch (err) {
    translateUnique(err, trimmed);
  }

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "academic_session.created",
    targetType: "academic_session",
    targetId: created.id,
    after: { label: created.label },
  });

  return created;
}

export async function updateAcademicSession(
  tx: Tx,
  actor: Actor,
  sessionId: string,
  label: string,
): Promise<AcademicSession> {
  if (!can(actor, "calendar:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot update an academic session");
  }

  const trimmed = label.trim();
  parseSessionLabel(trimmed);

  const [existing] = await tx
    .select()
    .from(academicSessions)
    .where(
      and(
        eq(academicSessions.id, sessionId),
        eq(academicSessions.schoolId, actor.schoolId),
      ),
    );
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Session not found in this school");
  }

  let updated: AcademicSession;
  try {
    const [row] = await tx
      .update(academicSessions)
      .set({ label: trimmed })
      .where(eq(academicSessions.id, sessionId))
      .returning();
    if (!row) throw new Error("session update returned no row");
    updated = row;
  } catch (err) {
    translateUnique(err, trimmed);
  }

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "academic_session.updated",
    targetType: "academic_session",
    targetId: updated.id,
    before: { label: existing.label },
    after: { label: updated.label },
  });

  return updated;
}

/**
 * The session of the currently active term, or the most recent session by
 * label when no term is active. `closed_at` is ignored here; writability is a
 * separate guard.
 */
export async function currentSession(
  executor: DbExecutor,
  actor: Actor,
  opts: { allowWithoutAcademicsRead?: boolean } = {},
): Promise<AcademicSession | null> {
  if (!opts.allowWithoutAcademicsRead && !can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot read the current session");
  }

  const [active] = await executor
    .select({ session: academicSessions })
    .from(terms)
    .innerJoin(academicSessions, eq(academicSessions.id, terms.sessionId))
    .where(
      and(eq(terms.schoolId, actor.schoolId), eq(terms.status, "active")),
    )
    .limit(1);

  if (active) return active.session;

  const [latest] = await executor
    .select()
    .from(academicSessions)
    .where(eq(academicSessions.schoolId, actor.schoolId))
    .orderBy(desc(academicSessions.label))
    .limit(1);

  return latest ?? null;
}

export async function listAcademicSessions(
  executor: DbExecutor,
  actor: Actor,
): Promise<AcademicSession[]> {
  if (!can(actor, "academics:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list academic sessions");
  }
  return executor
    .select()
    .from(academicSessions)
    .where(eq(academicSessions.schoolId, actor.schoolId))
    .orderBy(desc(academicSessions.label));
}
