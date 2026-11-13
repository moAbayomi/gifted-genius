import * as repo from "./repository.js";
import * as classRepo from "../classes/repository.js";
import { assertSessionOpen } from "../session-guard.js";
import { can, scopeFor } from "../../rbac/can.js";
import { and, eq, inArray } from "drizzle-orm";
import { classEnrollments } from "../../../db/schema/class-enrollments.js";
import type { Actor } from "../../rbac/can.js";
import { AppError } from "../../../shared/lib/errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { db } from "../../../db/client.js";
import type { DbExecutor, Tx } from "../../../db/types.js";
import type { ClassEnrollment } from "../../../db/schema/class-enrollments.js";
import type { RosterRow } from "./repository.js";

// ── Result shape (the contract) ───────────────────────────────────────

export interface EnrollResult {
  studentId: string;
  classId: string;
  enrollmentId: string;
  compulsorySubjects: number;
}

// ── Core: one transaction's worth of "create an enrollment" ──────────
//
// Owns the lock order and the guards. Callers (enrollStudent,
// transferStudent) check permissions, do flow-specific pre-checks,
// and write their own audit rows.
//
// @internal — exported for sibling reuse in transfer.ts, not part of the
// public service contract.

export interface CreateEnrollmentCoreInput {
  studentId: string;
  classId: string;
  startedAt: Date;
  transferredFromEnrollmentId?: string;
}

export interface CreateEnrollmentCoreResult {
  enrollment: ClassEnrollment;
  compulsorySubjects: number;
}

export async function createEnrollmentCore(
  tx: Tx,
  actor: Actor,
  input: CreateEnrollmentCoreInput,
): Promise<CreateEnrollmentCoreResult> {
  // 1. Read class unlocked — just to learn sessionId.
  const classMeta = await classRepo.findClass(
    tx,
    actor.schoolId,
    input.classId,
  );
  if (!classMeta) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  // 2. Lock session FOR SHARE — canonical lock order: session first.
  await assertSessionOpen(tx, actor.schoolId, classMeta.sessionId);

  // 3. Lock class FOR UPDATE, re-verify not archived.
  const cls = await classRepo.lockClass(tx, actor.schoolId, input.classId);
  if (!cls) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }
  if (cls.archivedAt !== null) {
    throw new AppError(
      409,
      "CLASS_ARCHIVED",
      "Cannot enroll in an archived class",
    );
  }

  // 4. Lock student + verify eligibility (active membership, student-kind role).
  const student = await repo.findEnrollableStudent(
    tx,
    actor.schoolId,
    input.studentId,
  );
  if (!student) {
    throw new AppError(
      404,
      "STUDENT_NOT_FOUND",
      "Student not found, not active, or not enrolled as a student",
    );
  }

  // 5. Insert the enrollment.
  const enrollment = await repo.insertClassEnrollment(tx, {
    schoolId: actor.schoolId,
    studentId: input.studentId,
    classId: cls.id,
    sessionId: cls.sessionId,
    startedAt: input.startedAt,
    transferredFromEnrollmentId: input.transferredFromEnrollmentId ?? null,
  });

  // 6. Auto-enroll in compulsory offerings — one bulk insert.
  const compulsory = await repo.listCompulsoryOfferingsInClass(
    tx,
    actor.schoolId,
    cls.id,
  );
  const compulsorySubjects = await repo.insertStudentSubjectsBulk(
    tx,
    compulsory.map((o) => ({
      schoolId: actor.schoolId,
      enrollmentId: enrollment.id,
      classId: cls.id,
      sessionId: cls.sessionId,
      classSubjectId: o.id,
    })),
  );

  return { enrollment, compulsorySubjects };
}

// ── Single enrollment: pre-check + core + audit ──────────────────────

export async function enrollStudent(
  tx: Tx,
  actor: Actor,
  input: { studentId: string; classId: string },
): Promise<EnrollResult> {
  if (!can(actor, "enrollments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot enroll students");
  }

  // Pre-check for a clean 409 in the common case.
  // The real race guarantee is the partial unique index mapped to
  // ALREADY_ENROLLED inside insertClassEnrollment.
  const classMeta = await classRepo.findClass(
    tx,
    actor.schoolId,
    input.classId,
  );
  if (!classMeta) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }
  const existing = await repo.findActiveEnrollmentForSession(
    tx,
    actor.schoolId,
    input.studentId,
    classMeta.sessionId,
  );
  if (existing) {
    throw new AppError(
      409,
      "ALREADY_ENROLLED",
      "Student is already actively enrolled in this session",
    );
  }

  // Delegate to the core.
  const { enrollment, compulsorySubjects } = await createEnrollmentCore(
    tx,
    actor,
    {
      studentId: input.studentId,
      classId: input.classId,
      startedAt: new Date(),
    },
  );

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "enrollment.created",
    targetType: "class_enrollment",
    targetId: enrollment.id,
    after: {
      studentId: enrollment.studentId,
      classId: enrollment.classId,
      sessionId: enrollment.sessionId,
      startedAt: enrollment.startedAt.toISOString(),
      compulsorySubjects,
    },
  });

  return {
    studentId: input.studentId,
    classId: enrollment.classId,
    enrollmentId: enrollment.id,
    compulsorySubjects,
  };
}

// ── Bulk + dry run ────────────────────────────────────────────────────

class DryRunRollback extends Error {
  constructor(public readonly results: EnrollResult[]) {
    super("dry-run rollback");
    this.name = "DryRunRollback";
  }
}

export async function bulkEnroll(
  actor: Actor,
  input: {
    classId: string;
    studentIds: string[];
    dryRun?: boolean | undefined;
  },
): Promise<EnrollResult[]> {
  if (!can(actor, "enrollments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot enroll students");
  }
  if (input.studentIds.length === 0) {
    return [];
  }
  if (new Set(input.studentIds).size !== input.studentIds.length) {
    throw new AppError(
      400,
      "DUPLICATE_STUDENT",
      "studentIds contains duplicates",
    );
  }

  const run = async (tx: Tx): Promise<EnrollResult[]> => {
    const results: EnrollResult[] = [];
    for (const studentId of input.studentIds) {
      results.push(
        await enrollStudent(tx, actor, { studentId, classId: input.classId }),
      );
    }
    return results;
  };

  if (!input.dryRun) {
    return db.transaction(run);
  }

  try {
    await db.transaction(async (tx) => {
      const result = await run(tx);
      throw new DryRunRollback(result);
    });
    throw new Error("dry-run transaction returned without rollback — bug");
  } catch (err) {
    if (err instanceof DryRunRollback) return err.results;
    throw err;
  }
}

export async function getClassRoster(
  executor: DbExecutor,
  actor: Actor,
  classId: string,
): Promise<RosterRow[]> {
  if (!can(actor, "enrollments:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot view class roster");
  }

  // Verify the class belongs to this school before listing.
  const cls = await classRepo.findClass(executor, actor.schoolId, classId);
  if (!cls) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Class not found in this school");
  }

  return repo.listRosterForClass(executor, actor.schoolId, classId);
}
export async function listEnrollments(
  executor: DbExecutor,
  actor: Actor,
  input: {
    classId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  },
): Promise<ClassEnrollment[]> {
  if (!can(actor, "enrollments:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot list enrollments");
  }
  const scope = scopeFor(actor, "enrollments:read");
  if (input.classId) {
    if (scope !== "all" && !scope.has(input.classId)) {
      throw new AppError(404, "CLASS_NOT_FOUND", "Class not found in this school");
    }
    const cls = await classRepo.findClass(executor, actor.schoolId, input.classId);
    if (!cls) {
      throw new AppError(404, "CLASS_NOT_FOUND", "Class not found in this school");
    }
  }
  if (!input.classId && scope !== "all" && scope.size === 0) return [];

  const where = input.classId
    ? and(
        eq(classEnrollments.schoolId, actor.schoolId),
        eq(classEnrollments.classId, input.classId),
        eq(classEnrollments.status, "active"),
      )
    : scope === "all"
      ? and(
          eq(classEnrollments.schoolId, actor.schoolId),
          eq(classEnrollments.status, "active"),
        )
      : and(
          eq(classEnrollments.schoolId, actor.schoolId),
          eq(classEnrollments.status, "active"),
          inArray(classEnrollments.classId, [...scope]),
        );

  return executor
    .select()
    .from(classEnrollments)
    .where(where)
    .limit(Math.min(input.limit ?? 50, 100))
    .offset(Math.max(input.offset ?? 0, 0));
}

export async function getEnrollmentById(
  executor: DbExecutor,
  actor: Actor,
  id: string,
): Promise<ClassEnrollment> {
  if (!can(actor, "enrollments:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot read enrollments");
  }
  const row = await repo.findEnrollment(executor, actor.schoolId, id);
  if (!row) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }
  if (!can(actor, "enrollments:read", { schoolId: actor.schoolId, classId: row.classId })) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }
  return row;
}
