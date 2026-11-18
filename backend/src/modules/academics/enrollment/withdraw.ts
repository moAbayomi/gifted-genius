// src/modules/academics/enrollment/withdraw.ts

import { eq, sql } from "drizzle-orm";
import * as repo from "./repository.js";
import * as classRepo from "../classes/repository.js";
import { assertSessionOpen } from "../session-guard.js";
import { can } from "../../rbac/can.js";
import type { Actor } from "../../rbac/can.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { AppError } from "../../../shared/lib/errors.js";
import { classEnrollments } from "../../../db/schema/class-enrollments.js";
import type { ClassEnrollment } from "../../../db/schema/class-enrollments.js";
import type { Tx } from "../../../db/types.js";
import { one } from "../../../shared/utils/assert.js";

export interface WithdrawResult {
  enrollment: ClassEnrollment;
}

export async function withdrawEnrollment(
  tx: Tx,
  actor: Actor,
  input: { enrollmentId: string; reason?: string | undefined },
): Promise<WithdrawResult> {
  // 1. Permission
  if (!can(actor, "enrollments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot withdraw enrollments");
  }

  // 2. Validate reason if provided — surface a clean 400 for whitespace-only
  //    before it hits the DB's `length(trim(...)) > 0` check (which would 500).
  if (input.reason !== undefined && input.reason.trim().length === 0) {
    throw new AppError(
      400,
      "INVALID_REASON",
      "Reason must be non-empty if provided",
    );
  }

  // 3. Load enrollment (unlocked) — verify active, get classId for the next lock.
  const enrollmentMeta = await repo.findEnrollment(
    tx,
    actor.schoolId,
    input.enrollmentId,
  );
  if (!enrollmentMeta) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }
  if (enrollmentMeta.status !== "active" || enrollmentMeta.endedAt !== null) {
    throw new AppError(
      409,
      "ENROLLMENT_NOT_ACTIVE",
      "Only active enrollments can be withdrawn",
    );
  }

  // 4. Load class (unlocked) — get sessionId for the session lock.
  const classMeta = await classRepo.findClass(
    tx,
    actor.schoolId,
    enrollmentMeta.classId,
  );
  if (!classMeta) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Enrollment's class not found");
  }

  // 5. Lock session FOR SHARE — canonical lock order: session first.
  await assertSessionOpen(tx, actor.schoolId, classMeta.sessionId);

  // 6. Lock class FOR UPDATE — blocks archiveClass.
  const cls = await classRepo.lockClass(
    tx,
    actor.schoolId,
    enrollmentMeta.classId,
  );
  if (!cls) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Enrollment's class not found");
  }
  if (cls.archivedAt !== null) {
    throw new AppError(
      409,
      "CLASS_ARCHIVED",
      "Cannot withdraw from an archived class",
    );
  }

  // 7. Lock enrollment FOR UPDATE — re-verify still active.
  //    Step 3's read is stale; a concurrent transfer/withdraw could have
  //    already ended this row.
  const enrollment = await repo.lockEnrollment(
    tx,
    actor.schoolId,
    input.enrollmentId,
  );
  if (!enrollment) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }
  if (enrollment.status !== "active" || enrollment.endedAt !== null) {
    throw new AppError(
      409,
      "ENROLLMENT_NOT_ACTIVE",
      "Only active enrollments can be withdrawn",
    );
  }

  // 8. Update the enrollment. Do NOT touch student_subjects.
  //    The row is preserved (archived via status='withdrawn'), and its
  //    student_subjects remain — the student's historical record of what
  //    they were taking when they left.
  const reason = input.reason?.trim() || "withdrawn";
  const ended = one(
    await tx
      .update(classEnrollments)
      .set({
        status: "withdrawn",
        endedAt: sql`now()`,
        endedReason: reason,
      })
      .where(eq(classEnrollments.id, enrollment.id))
      .returning(),
  );

  // 9. Audit — before/after shows the state transition cleanly.
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "enrollment.withdrawn",
    targetType: "class_enrollment",
    targetId: enrollment.id,
    before: {
      status: "active",
      endedAt: null,
    },
    after: {
      status: "withdrawn",
      endedAt: ended.endedAt?.toISOString() ?? null,
      endedReason: reason,
    },
    metadata: {
      classId: enrollment.classId,
      sessionId: enrollment.sessionId,
    },
  });

  return { enrollment: ended };
}
