import { and, eq, isNull, sql } from "drizzle-orm";
import { subjects, type Subject } from "../../../db/schema/subjects.js";
import type { DbExecutor } from "../../../db/types.js";
import { AppError } from "../../../shared/lib/errors.js";
import { isUniqueViolation } from "../../../shared/errors/pg-errors.js";
import { one } from "../../../shared/utils/assert.js";

/** School-scoped, code-normalized lookup. Used for duplicate detection. */
export async function findSubjectByCode(
  executor: DbExecutor,
  schoolId: string,
  code: string,
): Promise<Subject | null> {
  const [row] = await executor
    .select()
    .from(subjects)
    .where(and(eq(subjects.schoolId, schoolId), eq(subjects.code, code)))
    .limit(1);
  return row ?? null;
}

/**
 * School-scoped row lock. Must be called inside a transaction; otherwise the
 * FOR UPDATE lock is acquired and immediately released by the implicit commit.
 */
export async function lockSubject(
  executor: DbExecutor,
  schoolId: string,
  id: string,
): Promise<Subject | null> {
  const [row] = await executor
    .select()
    .from(subjects)
    .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, id)))
    .for("update")
    .limit(1);
  return row ?? null;
}

export interface ListSubjectsOptions {
  includeArchived?: boolean;
}

/** School-scoped list. Excludes archived by default. Order: code ASC. */
export async function listSubjects(
  executor: DbExecutor,
  schoolId: string,
  opts: ListSubjectsOptions = {},
): Promise<Subject[]> {
  const where = opts.includeArchived
    ? eq(subjects.schoolId, schoolId)
    : and(eq(subjects.schoolId, schoolId), isNull(subjects.archivedAt));

  return executor
    .select()
    .from(subjects)
    .where(where)
    .orderBy(subjects.code);
}

/**
 * Insert a normalized subject. Code collisions surface as
 * `SUBJECT_CODE_TAKEN`. The service pre-checks for the archived variant;
 * this catch fires on a concurrent insert race.
 */
export async function createSubject(
  executor: DbExecutor,
  data: { schoolId: string; code: string; name: string },
): Promise<Subject> {
  try {
    return one(
      await executor
        .insert(subjects)
        .values({
          schoolId: data.schoolId,
          code: data.code,
          name: data.name,
        })
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err, "subjects_school_code_uq")) {
      throw new AppError(
        409,
        "SUBJECT_CODE_TAKEN",
        `A subject with code "${data.code}" already exists`,
      );
    }
    throw err;
  }
}

/**
 * Update selected fields. The service owns the "is it archived?" pre-check
 * and the code-collision pre-check; this catch fires only on races.
 */
export async function updateSubject(
  executor: DbExecutor,
  schoolId: string,
  id: string,
  data: { code?: string; name?: string },
): Promise<Subject> {
  const patch: Partial<typeof subjects.$inferInsert> = {};
  if (data.code !== undefined) patch.code = data.code;
  if (data.name !== undefined) patch.name = data.name;

  try {
    const [row] = await executor
      .update(subjects)
      .set(patch)
      .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, id)))
      .returning();

    if (!row) {
      throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
    }
    return row;
  } catch (err) {
    if (isUniqueViolation(err, "subjects_school_code_uq")) {
      throw new AppError(
        409,
        "SUBJECT_CODE_TAKEN",
        data.code !== undefined
          ? `A subject with code "${data.code}" already exists`
          : "A subject with that code already exists",
      );
    }
    throw err;
  }
}

/** Idempotent archive write. Service handles the 404 and idempotent paths. */
export async function archiveSubject(
  executor: DbExecutor,
  schoolId: string,
  id: string,
): Promise<Subject> {
  const [row] = await executor
    .update(subjects)
    .set({ archivedAt: sql`now()` })
    .where(and(eq(subjects.schoolId, schoolId), eq(subjects.id, id)))
    .returning();

  if (!row) {
    throw new AppError(404, "SUBJECT_NOT_FOUND", "Subject not found");
  }
  return row;
}