import { eq, sql } from "drizzle-orm";
import * as repo from "./repository.js";
import * as classRepo from "../classes/repository.js";
import { assertSessionOpen } from "../session-guard.js";
import { createEnrollmentCore } from "./service.js";
import { can } from "../../rbac/can.js";
import type { Actor } from "../../rbac/can.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { AppError } from "../../../shared/lib/errors.js";
import { classEnrollments } from "../../../db/schema/class-enrollments.js";
import type { ClassEnrollment } from "../../../db/schema/class-enrollments.js";
import type { Tx } from "../../../db/types.js";
import { one } from "../../../shared/utils/assert.js";

export interface TransferResult {
  oldEnrollment: ClassEnrollment;
  newEnrollment: ClassEnrollment;
  compulsorySubjects: number;
}

export async function transferStudent(
  tx: Tx,
  actor: Actor,
  input: { enrollmentId: string; targetClassId: string },
): Promise<TransferResult> {
  // 1. Permission
  if (!can(actor, "enrollments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot transfer students");
  }

  // 2. Load current enrollment (unlocked) — verify active.
  const currentMeta = await repo.findEnrollment(
    tx,
    actor.schoolId,
    input.enrollmentId,
  );
  if (!currentMeta) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }
  if (currentMeta.status !== "active" || currentMeta.endedAt !== null) {
    throw new AppError(409, "ENROLLMENT_NOT_ACTIVE", "Enrollment is not active");
  }

  // 3. Same-class check — cheapest failure, before any locks.
  if (currentMeta.classId === input.targetClassId) {
    throw new AppError(
      409,
      "SAME_CLASS",
      "Student is already in the target class",
    );
  }

  // 4. Load target class (unlocked) — get sessionId for the session lock.
  const targetClassMeta = await classRepo.findClass(
    tx,
    actor.schoolId,
    input.targetClassId,
  );
  if (!targetClassMeta) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Target class not found");
  }

  // 5. Lock session FOR SHARE — canonical lock order: session first.
  //    Deviates from the brief's listed order (which had enrollment first)
  //    to match setElectives's session → class → enrollment order and
  //    prevent deadlock between concurrent transfer + setElectives calls.
  await assertSessionOpen(tx, actor.schoolId, targetClassMeta.sessionId);

  // 6. Lock target class FOR UPDATE.
  const targetCls = await classRepo.lockClass(
    tx,
    actor.schoolId,
    input.targetClassId,
  );
  if (!targetCls) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Target class not found");
  }
  if (targetCls.archivedAt !== null) {
    throw new AppError(409, "CLASS_ARCHIVED", "Target class is archived");
  }

  // 7. Lock old enrollment FOR UPDATE — re-verify still active.
  //    Step 2's read is stale; a concurrent end/transfer could have run.
  const oldEnrollment = await repo.lockEnrollment(
    tx,
    actor.schoolId,
    input.enrollmentId,
  );
  if (!oldEnrollment) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }
  if (oldEnrollment.status !== "active" || oldEnrollment.endedAt !== null) {
    throw new AppError(409, "ENROLLMENT_NOT_ACTIVE", "Enrollment is not active");
  }

  // 8. End the old enrollment FIRST.
  //    Critical ordering: the partial unique index (student_id, session_id)
  //    WHERE ended_at IS NULL rejects the new insert if the old is still
  //    active AND both are in the same session. Ending before inserting
  //    closes that window.
  const endedOld = one(await tx
    .update(classEnrollments)
    .set({
      status: "transferred",
      endedAt: sql`now()`,
      endedReason: "transferred",
    })
    .where(eq(classEnrollments.id, oldEnrollment.id))
    .returning());

  // 9. Create the new enrollment via the shared core.
  //    Core owns session/class/student locks + guards + insert + auto-enroll.
  //    Session derived from target class. transferred_from_enrollment_id
  //    links back. Elective choices NOT copied — student re-selects.
  const { enrollment: newEnrollment, compulsorySubjects } =
    await createEnrollmentCore(tx, actor, {
      studentId: oldEnrollment.studentId,
      classId: targetCls.id,
      startedAt: new Date(),
      transferredFromEnrollmentId: oldEnrollment.id,
    });

  // 10. Two audit rows — old ended, new created — both linked.
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "enrollment.transferred",
    targetType: "class_enrollment",
    targetId: oldEnrollment.id,
    before: {
      status: "active",
      endedAt: null,
      classId: oldEnrollment.classId,
    },
    after: {
      status: "transferred",
      endedAt: endedOld.endedAt?.toISOString() ?? null,
      endedReason: "transferred",
    },
    metadata: {
      newEnrollmentId: newEnrollment.id,
      targetClassId: targetCls.id,
    },
  });

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "enrollment.created",
    targetType: "class_enrollment",
    targetId: newEnrollment.id,
    after: {
      studentId: newEnrollment.studentId,
      classId: newEnrollment.classId,
      sessionId: newEnrollment.sessionId,
      startedAt: newEnrollment.startedAt.toISOString(),
      transferredFromEnrollmentId: oldEnrollment.id,
      compulsorySubjects,
    },
    metadata: { via: "transfer" },
  });

  return {
    oldEnrollment: endedOld,
    newEnrollment,
    compulsorySubjects,
  };
}