// src/modules/academics/enrollment/electives.ts

import * as repo from "./repository.js";
import * as classRepo from "../classes/repository.js";
import { assertSessionOpen } from "../session-guard.js";
import { computeSelection } from "./selection.js";
import type {
  ElectiveGroup,
  ElectiveOffering,
  ChosenOffering,
  SelectionProblem,
  GroupSelection,
} from "./selection.js";
import { can } from "../../rbac/can.js";
import type { Actor } from "../../rbac/can.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { AppError } from "../../../shared/lib/errors.js";
import type { Tx } from "../../../db/types.js";

export interface SetElectivesResult {
  complete: boolean;
  problems: SelectionProblem[];
  groups: GroupSelection[];
  active: number;
  dropped: number;
}

export async function setElectives(
  tx: Tx,
  actor: Actor,
  input: { enrollmentId: string; offeringIds: string[] },
): Promise<SetElectivesResult> {
  // 1. Permission
  if (!can(actor, "enrollments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot set electives");
  }

  // 2. Reject duplicate offering IDs up front — before touching the DB.
  const uniqueOfferings = new Set(input.offeringIds);
  if (uniqueOfferings.size !== input.offeringIds.length) {
    throw new AppError(
      400,
      "DUPLICATE_OFFERING",
      "offeringIds contains duplicates",
    );
  }

  // 3. Read enrollment UNLOCKED — just to learn classId for the next lock.
  const enrollmentMeta = await repo.findEnrollment(
    tx,
    actor.schoolId,
    input.enrollmentId,
  );
  if (!enrollmentMeta || enrollmentMeta.endedAt !== null) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }

  // 4. Read class UNLOCKED — just to learn sessionId for the session lock.
  const classMeta = await classRepo.findClass(
    tx,
    actor.schoolId,
    enrollmentMeta.classId,
  );
  if (!classMeta) {
    throw new AppError(
      404,
      "ENROLLMENT_NOT_FOUND",
      "Enrollment's class not found",
    );
  }

  // 5. Lock session FOR SHARE — canonical lock order: session first.
  //    Blocks closeSession, allows concurrent setElectives.
  await assertSessionOpen(tx, actor.schoolId, classMeta.sessionId);

  // 6. Lock class FOR UPDATE — blocks archiveClass, addOfferings.
  const cls = await classRepo.lockClass(tx, actor.schoolId, enrollmentMeta.classId);
  if (!cls) {
    throw new AppError(
      404,
      "ENROLLMENT_NOT_FOUND",
      "Enrollment's class not found",
    );
  }
  if (cls.archivedAt !== null) {
    throw new AppError(
      409,
      "CLASS_ARCHIVED",
      "Cannot set electives on a class that has been archived",
    );
  }

  // 7. Lock enrollment FOR UPDATE — re-verify still active.
  //    Step 3's read is stale; a concurrent endEnrollment could have run
  //    between then and now.
  const enrollment = await repo.lockEnrollment(
    tx,
    actor.schoolId,
    input.enrollmentId,
  );
  if (!enrollment || enrollment.endedAt !== null) {
    throw new AppError(404, "ENROLLMENT_NOT_FOUND", "Enrollment not found");
  }

  // 8. Load elective offerings + groups (live only).
  const dbOfferings = await repo.listElectiveOfferingsForClass(
    tx,
    actor.schoolId,
    cls.id,
  );
  const dbGroups = await repo.listElectiveGroupsForClass(
    tx,
    actor.schoolId,
    cls.id,
  );

  // 9. Map DB rows → pure-function input.
  const groups: ElectiveGroup[] = dbGroups.map((g) => ({
    id: g.id,
    name: g.name,
    minChoices: g.minChoices,
    maxChoices: g.maxChoices,
  }));
  const offerings: ElectiveOffering[] = dbOfferings.map((o) => ({
    id: o.id,
    groupId: o.electiveGroupId,
  }));
  const chosen: ChosenOffering[] = input.offeringIds.map((id) => ({
    offeringId: id,
  }));

  // 10. Pure validation — the only place the rule lives.
  const selection = computeSelection({ groups, offerings, chosen });

  // 11. Blocking problems → refuse, write nothing.
  if (!selection.canSave) {
    const blocking = selection.problems.filter(
      (p) => p.severity === "blocking",
    );
    throw new AppError(
      409,
      "INVALID_ELECTIVE_SELECTION",
      "Elective selection has blocking problems",
      JSON.stringify(blocking),
    );
  }
  // Non-blocking (TOO_FEW) does not refuse — save as draft.

  // 12. Lock ALL student_subjects rows for this enrollment.
  //     Returns active, dropped, compulsory, and extras in one query.
  //     Locking first serializes concurrent setElectives calls so that
  //     toDrop is computed against the winner's committed state.
  const existing = await repo.lockStudentSubjectsForEnrollment(
    tx,
    enrollment.id,
  );

  // 13. Build lookup maps.
  const electiveOfferingIds = new Set(dbOfferings.map((o) => o.id));

  const byOfferingId = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    if (row.classSubjectId !== null) {
      byOfferingId.set(row.classSubjectId, row);
    }
  }

  const chosenIds = new Set(input.offeringIds);

  // 14. Compute three disjoint deltas.
  //
  // 14a. Chosen offerings → reactivate (dropped), insert (absent), or leave (active).
  const toReactivate: string[] = [];
  const toInsert: string[] = [];
  for (const offeringId of input.offeringIds) {
    const row = byOfferingId.get(offeringId);
    if (!row) {
      toInsert.push(offeringId);
    } else if (row.droppedAt !== null) {
      toReactivate.push(offeringId);
    }
    // else: active — leave untouched (no updated_at bump).
  }

  // 14b. Active electives not chosen → drop.
  //      Filters ensure compulsory rows and extras are never touched:
  //        - droppedAt === null         → only currently active
  //        - classSubjectId !== null    → excludes extras
  //        - electiveOfferingIds.has    → excludes compulsory
  //        - !chosenIds.has             → only ones being abandoned
  const toDrop: string[] = [];
  for (const row of existing) {
    if (row.droppedAt !== null) continue;
    if (row.classSubjectId === null) continue;
    if (!electiveOfferingIds.has(row.classSubjectId)) continue;
    if (chosenIds.has(row.classSubjectId)) continue;
    toDrop.push(row.classSubjectId);
  }

  // 15. Apply the three deltas — three bulk statements, no per-row loops.
  //     All three are idempotent, so retry with the same input is a no-op
  //     after the first successful run.
  if (toDrop.length > 0) {
    await repo.markStudentSubjectsDropped(tx, enrollment.id, toDrop);
  }
  if (toReactivate.length > 0) {
    await repo.markStudentSubjectsReactivated(tx, enrollment.id, toReactivate);
  }
  if (toInsert.length > 0) {
    await repo.insertStudentSubjectsBulk(
      tx,
      toInsert.map((offeringId) => ({
        schoolId: actor.schoolId,
        enrollmentId: enrollment.id,
        classId: cls.id,
        sessionId: cls.sessionId,
        classSubjectId: offeringId,
      })),
    );
  }

  // 16. Audit.
  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "student_subjects.electives_set",
    targetType: "class_enrollment",
    targetId: enrollment.id,
    after: {
      chosenOfferingIds: input.offeringIds,
      active: chosenIds.size,
      dropped: toDrop.length,
      complete: selection.complete,
    },
  });

  // 17. Return — `problems` naturally contains only TOO_FEW at this point
  //     (all blockers threw as 409 above).
  const active = await repo.countActiveElectives(tx, enrollment.id);
  return {
    complete: selection.complete,
    problems: selection.problems,
    groups: selection.groups,
    active,
    dropped: toDrop.length,
  };
}