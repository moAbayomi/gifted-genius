import { and, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  classEnrollments,
  type ClassEnrollment,
} from "../../../db/schema/class-enrollments.js";
import {
  studentProfiles,
  type StudentProfile,
} from "../../../db/schema/student-profiles.js";
import {
  memberships,
  membershipRoles,
  roles,
  users,
} from "../../../db/schema/index.js";
import {
  classSubjects,
  type ClassSubject,
} from "../../../db/schema/class-subjects.js";
import { studentSubjects } from "../../../db/schema/student-subjects.js";
import type { DbExecutor } from "../../../db/types.js";
import { AppError } from "../../../shared/lib/errors.js";
import { isUniqueViolation } from "../../../shared/errors/pg-errors.js";
import { one } from "../../../shared/utils/assert.js";

import { electiveGroups } from "../../../db/schema/elective-groups.js";
import type { ElectiveGroup } from "../../../db/schema/elective-groups.js";
import { inArray } from "drizzle-orm";


export interface RosterRow {
  enrollmentId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  admissionNumber: string;
  house: string | null;
  startedAt: Date;
}



// ── Lookups ───────────────────────────────────────────────────────────

export async function findEnrollableStudent(
  executor: DbExecutor,
  schoolId: string,
  studentId: string,
): Promise<StudentProfile | null> {
  const [row] = await executor
    .select({ student: studentProfiles })
    .from(studentProfiles)
    .innerJoin(memberships, eq(memberships.id, studentProfiles.membershipId))
    .innerJoin(
      membershipRoles,
      eq(membershipRoles.membershipId, memberships.id),
    )
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(
      and(
        eq(studentProfiles.schoolId, schoolId),
        eq(studentProfiles.id, studentId),
        eq(memberships.status, "active"),
        eq(roles.kind, "student"), // kind, not key — the brief is explicit
      ),
    )
    .for("share")
    .limit(1);
  return row?.student ?? null;
}

/**
 * The class's compulsory, live offerings — the ones that get auto-enrolled
 * into a new student's `student_subjects`.
 */
export async function listCompulsoryOfferingsInClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<ClassSubject[]> {
  return executor
    .select()
    .from(classSubjects)
    .where(
      and(
        eq(classSubjects.schoolId, schoolId),
        eq(classSubjects.classId, classId),
        eq(classSubjects.isCompulsory, true),
        isNull(classSubjects.archivedAt),
      ),
    );
}

// ── Writes ────────────────────────────────────────────────────────────

export interface NewClassEnrollmentData {
  schoolId: string;
  studentId: string;
  classId: string;
  sessionId: string; // derived by the service from class.sessionId
  startedAt: Date;
  transferredFromEnrollmentId?: string | null;
}

export async function insertClassEnrollment(
  executor: DbExecutor,
  data: NewClassEnrollmentData,
): Promise<ClassEnrollment> {
  try {
    return one(
      await executor
        .insert(classEnrollments)
        .values({
          schoolId: data.schoolId,
          studentId: data.studentId,
          classId: data.classId,
          sessionId: data.sessionId,
          startedAt: data.startedAt,
          endedAt: null,
          endedReason: null,
          transferredFromEnrollmentId: data.transferredFromEnrollmentId ?? null,
        })
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err, "class_enrollments_one_active_session_uq")) {
      throw new AppError(
        409,
        "ALREADY_ENROLLED",
        "Student already has an active enrollment in this session",
      );
    }
    throw err;
  }
}

export interface NewStudentSubjectData {
  schoolId: string;
  enrollmentId: string;
  classId: string;
  sessionId: string;
  classSubjectId: string;
}

/**
 * Bulk-insert student_subjects rows for the compulsory auto-enroll.
 * Returns the number inserted.
 */
export async function insertStudentSubjectsBulk(
  executor: DbExecutor,
  rows: NewStudentSubjectData[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await executor
    .insert(studentSubjects)
    .values(rows.map((r) => ({ ...r, subjectId: null })))
    .onConflictDoNothing()
    .returning({ id: studentSubjects.id });
  return inserted.length;
}

export async function findActiveEnrollmentForSession(
  executor: DbExecutor,
  schoolId: string,
  studentId: string,
  sessionId: string,
): Promise<ClassEnrollment | null> {
  const [row] = await executor
    .select()
    .from(classEnrollments)
    .where(
      and(
        eq(classEnrollments.schoolId, schoolId),
        eq(classEnrollments.studentId, studentId),
        eq(classEnrollments.sessionId, sessionId),
        isNull(classEnrollments.endedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// ── Elective selection (setElectives) ─────────────────────────────────

/**
 * Load one enrollment by ID, school-scoped.
 * Unlike `findActiveEnrollmentForSession`, this returns ended enrollments too —
 * the caller (setElectives) decides whether ended is acceptable.
 */
export async function findEnrollment(
  executor: DbExecutor,
  schoolId: string,
  enrollmentId: string,
): Promise<ClassEnrollment | null> {
  const [row] = await executor
    .select()
    .from(classEnrollments)
    .where(
      and(
        eq(classEnrollments.schoolId, schoolId),
        eq(classEnrollments.id, enrollmentId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The class's live elective offerings (is_compulsory = false).
 * These are what a student can choose from in setElectives.
 */
export async function listElectiveOfferingsForClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<ClassSubject[]> {
  return executor
    .select()
    .from(classSubjects)
    .where(
      and(
        eq(classSubjects.schoolId, schoolId),
        eq(classSubjects.classId, classId),
        eq(classSubjects.isCompulsory, false),
        isNull(classSubjects.archivedAt),
      ),
    );
}

/**
 * The class's live elective groups — the rules that setElectives validates against.
 */
export async function listElectiveGroupsForClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<ElectiveGroup[]> {
  return executor
    .select()
    .from(electiveGroups)
    .where(
      and(
        eq(electiveGroups.schoolId, schoolId),
        eq(electiveGroups.classId, classId),
        isNull(electiveGroups.archivedAt),
      ),
    );
}

/**
 * Currently active (not dropped) student_subjects for an enrollment.
 * Used to diff "what they had" vs. "what they're setting."
 */
export async function listActiveStudentSubjects(
  executor: DbExecutor,
  enrollmentId: string,
): Promise<Array<{ classSubjectId: string | null; subjectId: string | null }>> {
  const rows = await executor
    .select({
      classSubjectId: studentSubjects.classSubjectId,
      subjectId: studentSubjects.subjectId,
    })
    .from(studentSubjects)
    .where(
      and(
        eq(studentSubjects.enrollmentId, enrollmentId),
        isNull(studentSubjects.droppedAt),
      ),
    );
  return rows;
}

/**
 * Set `dropped_at = now()` for the given offerings on this enrollment.
 * Only touches rows that are currently active (droppedAt IS NULL) — so
 * double-dropping is a no-op for already-dropped rows.
 */
export async function markStudentSubjectsDropped(
  executor: DbExecutor,
  enrollmentId: string,
  offeringIds: string[],
): Promise<number> {
  if (offeringIds.length === 0) return 0;
  const updated = await executor
    .update(studentSubjects)
    .set({ droppedAt: sql`now()` })
    .where(
      and(
        eq(studentSubjects.enrollmentId, enrollmentId),
        inArray(studentSubjects.classSubjectId, offeringIds),
        isNull(studentSubjects.droppedAt),
      ),
    )
    .returning({ id: studentSubjects.id });
  return updated.length;
}

/**
 * For each (enrollment_id, class_subject_id) pair:
 *   - if no row exists         → INSERT with dropped_at NULL (fresh choice)
 *   - if row exists (dropped)  → UPDATE SET dropped_at = NULL (reactivate)
 *   - if row exists (active)   → no-op
 *
 * This is what the existing unique constraints enable:
 *   unique (enrollment_id, class_subject_id)
 * turns "reactivate" into an UPDATE, not a duplicate INSERT.
 */
export async function upsertStudentSubjectsBulk(
  executor: DbExecutor,
  rows: NewStudentSubjectData[],
): Promise<void> {
  if (rows.length === 0) return;
  await executor
    .insert(studentSubjects)
    .values(rows.map((r) => ({ ...r, subjectId: null, droppedAt: null })))
    .onConflictDoUpdate({
      target: [studentSubjects.enrollmentId, studentSubjects.classSubjectId],
      set: { droppedAt: null },
    });
}

/**
 * Count active elective choices for an enrollment.
 * Used to populate the `active` field in setElectives's return shape.
 */
export async function countActiveElectives(
  executor: DbExecutor,
  enrollmentId: string,
): Promise<number> {
  const [row] = await executor
    .select({ n: count() })
    .from(studentSubjects)
    .innerJoin(
      classSubjects,
      eq(classSubjects.id, studentSubjects.classSubjectId),
    )
    .where(
      and(
        eq(studentSubjects.enrollmentId, enrollmentId),
        isNull(studentSubjects.droppedAt),
        eq(classSubjects.isCompulsory, false),
      ),
    );
  return row?.n ?? 0;
}

// src/modules/academics/enrollment/repository.ts

export async function markStudentSubjectsReactivated(
  executor: DbExecutor,
  enrollmentId: string,
  offeringIds: string[],
): Promise<number> {
  if (offeringIds.length === 0) return 0;
  const updated = await executor
    .update(studentSubjects)
    .set({ droppedAt: null })
    .where(
      and(
        eq(studentSubjects.enrollmentId, enrollmentId),
        inArray(studentSubjects.classSubjectId, offeringIds),
        isNotNull(studentSubjects.droppedAt),
      ),
    )
    .returning({ id: studentSubjects.id });
  return updated.length;
}

export async function lockEnrollment(
  executor: DbExecutor,
  schoolId: string,
  enrollmentId: string,
): Promise<ClassEnrollment | null> {
  const [row] = await executor
    .select()
    .from(classEnrollments)
    .where(
      and(
        eq(classEnrollments.schoolId, schoolId),
        eq(classEnrollments.id, enrollmentId),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function lockStudentSubjectsForEnrollment(
  executor: DbExecutor,
  enrollmentId: string,
): Promise<Array<typeof studentSubjects.$inferSelect>> {
  return executor
    .select()
    .from(studentSubjects)
    .where(eq(studentSubjects.enrollmentId, enrollmentId))
    .for("update");
}


export async function listRosterForClass(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<RosterRow[]> {
  return executor
    .select({
      enrollmentId: classEnrollments.id,
      studentId: studentProfiles.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      admissionNumber: studentProfiles.admissionNumber,
      house: studentProfiles.house,
      startedAt: classEnrollments.startedAt,
    })
    .from(classEnrollments)
    .innerJoin(
      studentProfiles,
      eq(studentProfiles.id, classEnrollments.studentId),
    )
    .innerJoin(
      memberships,
      eq(memberships.id, studentProfiles.membershipId),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(classEnrollments.schoolId, schoolId),
        eq(classEnrollments.classId, classId),
        isNull(classEnrollments.endedAt),
      ),
    )
    .orderBy(users.lastName, users.firstName);
}