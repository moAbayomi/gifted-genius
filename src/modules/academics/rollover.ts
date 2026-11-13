import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../../db/types.js";
import { classes } from "../../db/schema/classes.js";
import {
  classSubjects,
  electiveGroups,
  memberships,
  subjectTeacherAssignments,
} from "../../db/schema/index.js";
import { AppError } from "../../shared/lib/errors.js";
import { recordAudit } from "../../shared/audit/record.js";
import { can, type Actor } from "../rbac/can.js";
import * as classRepo from "./classes/repository.js";
import { cloneClasses } from "./classes/service.js";

export interface RolloverResult {
  classesCloned: number;
  groupsCopied: number;
  offeringsCopied: number;
  formAssignmentsCopied: number;
  subjectAssignmentsCopied: number;
  skippedTeachers: Array<{ membershipId: string; reason: string }>;
}

function classKey(levelId: string, armLabel: string, track: string): string {
  return `${levelId}:${armLabel}:${track}`;
}

/**
 * Copy a previous session's structure into a new session.
 *
 * Order matters: classes first (cloneClasses), then elective groups for the
 * copied classes, then active offerings. Every write is idempotent through
 * its unique key, so a second run is a no-op.
 *
 * Assignments are deliberately NOT copied yet. See copyAssignments below.
 */
export async function rolloverSession(
  tx: Tx,
  actor: Actor,
  input: { fromSessionId: string; toSessionId: string },
): Promise<RolloverResult> {
  if (!can(actor, "structure:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot roll over a session");
  }
  if (input.fromSessionId === input.toSessionId) {
    throw new AppError(
      400,
      "SAME_SESSION",
      "Source and target sessions must differ",
    );
  }

  // 1. Classes first. cloneClasses owns source/target validation, the target
  //    session-open guard, archived levels, and class audit rows.
  const cloneResult = await cloneClasses(tx, actor, {
    fromSessionId: input.fromSessionId,
    toSessionId: input.toSessionId,
  });

  const sourceClasses = await classRepo.listClasses(tx, actor.schoolId, {
    sessionId: input.fromSessionId,
  });
  const targetClasses = await classRepo.listClasses(tx, actor.schoolId, {
    sessionId: input.toSessionId,
  });

  const targetByKey = new Map(
    targetClasses.map((c) => [classKey(c.levelId, c.armLabel, c.track), c]),
  );
  const usableSourceClasses = sourceClasses.filter(
    (c) =>
      c.level.archivedAt === null &&
      targetByKey.has(classKey(c.levelId, c.armLabel, c.track)),
  );

  const sourceClassIds = usableSourceClasses.map((c) => c.id);
  const targetClassIds = usableSourceClasses.map(
    (c) => targetByKey.get(classKey(c.levelId, c.armLabel, c.track))!.id,
  );

  if (sourceClassIds.length === 0) {
    return {
      classesCloned: cloneResult.cloned.length,
      groupsCopied: 0,
      offeringsCopied: 0,
      formAssignmentsCopied: 0,
      subjectAssignmentsCopied: 0,
      skippedTeachers: [],
    };
  }

  // 2. Elective groups. They are class-scoped, so the source group IDs cannot
  //    be reused in the target class. Copy by (targetClassId, name), then map
  //    source group IDs to target group IDs for the offerings.
  const sourceGroups = await tx
    .select()
    .from(electiveGroups)
    .where(
      and(
        eq(electiveGroups.schoolId, actor.schoolId),
        inArray(electiveGroups.classId, sourceClassIds),
        isNull(electiveGroups.archivedAt),
      ),
    );

  const sourceClassToTarget = new Map(
    usableSourceClasses.map((sourceClass) => [
      sourceClass.id,
      targetByKey.get(
        classKey(sourceClass.levelId, sourceClass.armLabel, sourceClass.track),
      )!,
    ]),
  );

  const existingTargetGroups = await tx
    .select()
    .from(electiveGroups)
    .where(
      and(
        eq(electiveGroups.schoolId, actor.schoolId),
        inArray(electiveGroups.classId, targetClassIds),
      ),
    );
  const targetGroupByName = new Map(
    existingTargetGroups.map((g) => [`${g.classId}:${g.name}`, g]),
  );

  const groupsToInsert = sourceGroups.flatMap((sourceGroup) => {
    const targetClass = sourceClassToTarget.get(sourceGroup.classId);
    if (!targetClass) return [];
    const key = `${targetClass.id}:${sourceGroup.name}`;
    if (targetGroupByName.has(key)) return [];
    return [{
      schoolId: actor.schoolId,
      classId: targetClass.id,
      sessionId: targetClass.sessionId,
      name: sourceGroup.name,
      minChoices: sourceGroup.minChoices,
      maxChoices: sourceGroup.maxChoices,
    }];
  });

  if (groupsToInsert.length > 0) {
    await tx
      .insert(electiveGroups)
      .values(groupsToInsert)
      .onConflictDoNothing();
  }

  // Re-read target groups so a group that already existed and one inserted
  // above both get a target ID.
  const allTargetGroups = await tx
    .select()
    .from(electiveGroups)
    .where(
      and(
        eq(electiveGroups.schoolId, actor.schoolId),
        inArray(electiveGroups.classId, targetClassIds),
      ),
    );

  const targetGroupIdByClassAndName = new Map(
    allTargetGroups.map((g) => [`${g.classId}:${g.name}`, g.id]),
  );
  const sourceGroupToTargetGroup = new Map<string, string>();
  for (const sourceGroup of sourceGroups) {
    const targetClass = sourceClassToTarget.get(sourceGroup.classId);
    if (!targetClass) continue;
    const targetId = targetGroupIdByClassAndName.get(
      `${targetClass.id}:${sourceGroup.name}`,
    );
    if (targetId) sourceGroupToTargetGroup.set(sourceGroup.id, targetId);
  }

  // 3. Active offerings of the source classes. onConflictDoNothing on the
  //    unique (class_id, subject_id) makes a second run a no-op.
  const sourceOfferings = await tx
    .select()
    .from(classSubjects)
    .where(
      and(
        eq(classSubjects.schoolId, actor.schoolId),
        inArray(classSubjects.classId, sourceClassIds),
        isNull(classSubjects.archivedAt),
      ),
    );

  const offeringsToInsert = sourceOfferings.flatMap((offering) => {
    const targetClass = sourceClassToTarget.get(offering.classId);
    if (!targetClass) return [];
    return [{
      schoolId: actor.schoolId,
      classId: targetClass.id,
      subjectId: offering.subjectId,
      isCompulsory: offering.isCompulsory,
      // Preserve the group when it was copied. If the source group was
      // archived/missing, keep the offering as an ungrouped elective rather
      // than attaching it to the source class's group.
      electiveGroupId: offering.electiveGroupId
        ? sourceGroupToTargetGroup.get(offering.electiveGroupId) ?? null
        : null,
    }];
  });

  const insertedOfferings = offeringsToInsert.length
    ? await tx
        .insert(classSubjects)
        .values(offeringsToInsert)
        .onConflictDoNothing()
        .returning({ id: classSubjects.id })
    : [];

  const assignmentReport = await copyAssignments(tx, actor, {
    sourceClasses: usableSourceClasses,
    targetByKey,
    sourceOfferings,
  });

  if (
    cloneResult.cloned.length > 0 ||
    groupsToInsert.length > 0 ||
    insertedOfferings.length > 0 ||
    assignmentReport.formAssignmentsCopied > 0 ||
    assignmentReport.subjectAssignmentsCopied > 0
  ) {
    await recordAudit(tx, {
      schoolId: actor.schoolId,
      actorMembershipId: actor.membershipId,
      action: "session.rolled_over",
      targetType: "academic_session",
      targetId: input.toSessionId,
      after: {
        fromSessionId: input.fromSessionId,
        classesCloned: cloneResult.cloned.length,
        groupsCopied: groupsToInsert.length,
        offeringsCopied: insertedOfferings.length,
        formAssignmentsCopied: assignmentReport.formAssignmentsCopied,
        subjectAssignmentsCopied: assignmentReport.subjectAssignmentsCopied,
        skippedTeachers: assignmentReport.skippedTeachers,
      },
    });
  }

  return {
    classesCloned: cloneResult.cloned.length,
    groupsCopied: groupsToInsert.length,
    offeringsCopied: insertedOfferings.length,
    ...assignmentReport,
  };
}

/** Copy active form and subject-teacher assignments into the target session. */
async function copyAssignments(
  tx: Tx,
  actor: Actor,
  context: {
    sourceClasses: Awaited<ReturnType<typeof classRepo.listClasses>>;
    targetByKey: Map<string, Awaited<ReturnType<typeof classRepo.listClasses>>[number]>;
    sourceOfferings: Array<typeof classSubjects.$inferSelect>;
  },
): Promise<{
  formAssignmentsCopied: number;
  subjectAssignmentsCopied: number;
  skippedTeachers: Array<{ membershipId: string; reason: string }>;
}> {
  const { sourceClasses, targetByKey, sourceOfferings } = context;
  const targetClasses = [...targetByKey.values()];
  const targetClassIds = targetClasses.map((c) => c.id);
  const teacherIds = new Set<string>();
  for (const sourceClass of sourceClasses) {
    if (sourceClass.formTeacherMembershipId) {
      teacherIds.add(sourceClass.formTeacherMembershipId);
    }
  }

  const sourceAssignments =
    sourceClasses.length === 0
      ? []
      : await tx
          .select()
          .from(subjectTeacherAssignments)
          .where(
            and(
              eq(subjectTeacherAssignments.schoolId, actor.schoolId),
              inArray(subjectTeacherAssignments.classId, sourceClasses.map((c) => c.id)),
              isNull(subjectTeacherAssignments.endedAt),
            ),
          );
  for (const assignment of sourceAssignments) {
    teacherIds.add(assignment.teacherMembershipId);
  }

  const activeTeacherIds = new Set(
    teacherIds.size === 0
      ? []
      : (
          await tx
            .select({ id: memberships.id })
            .from(memberships)
            .where(
              and(
                eq(memberships.schoolId, actor.schoolId),
                eq(memberships.status, "active"),
                inArray(memberships.id, [...teacherIds]),
              ),
            )
        ).map((r) => r.id),
  );

  const skippedTeachers: Array<{ membershipId: string; reason: string }> = [];
  const skip = (membershipId: string, reason: string) => {
    if (!skippedTeachers.some((s) => s.membershipId === membershipId)) {
      skippedTeachers.push({ membershipId, reason });
    }
  };

  let formAssignmentsCopied = 0;
  for (const sourceClass of sourceClasses) {
    const targetClass = targetByKey.get(
      classKey(sourceClass.levelId, sourceClass.armLabel, sourceClass.track),
    );
    if (!targetClass) continue;
    const teacherId = sourceClass.formTeacherMembershipId;
    if (!teacherId) continue;
    if (!activeTeacherIds.has(teacherId)) {
      skip(teacherId, "MEMBERSHIP_INACTIVE");
      continue;
    }
    if (targetClass.formTeacherMembershipId === teacherId) continue;
    if (targetClass.formTeacherMembershipId !== null) {
      skip(teacherId, "TARGET_FORM_TEACHER_SET");
      continue;
    }
    await tx
      .update(classes)
      .set({ formTeacherMembershipId: teacherId })
      .where(eq(classes.id, targetClass.id));
    formAssignmentsCopied += 1;
  }

  const targetOfferings =
    targetClassIds.length === 0
      ? []
      : await tx
          .select({ id: classSubjects.id, classId: classSubjects.classId, subjectId: classSubjects.subjectId })
          .from(classSubjects)
          .where(
            and(
              eq(classSubjects.schoolId, actor.schoolId),
              inArray(classSubjects.classId, targetClassIds),
              isNull(classSubjects.archivedAt),
            ),
          );
  const targetOfferingByClassSubject = new Map(
    targetOfferings.map((o) => [`${o.classId}:${o.subjectId}`, o.id]),
  );
  const sourceOfferingById = new Map(sourceOfferings.map((o) => [o.id, o]));

  let subjectAssignmentsCopied = 0;
  for (const assignment of sourceAssignments) {
    const sourceClass = sourceClasses.find((c) => c.id === assignment.classId);
    if (!sourceClass) continue;
    const targetClass = targetByKey.get(
      classKey(sourceClass.levelId, sourceClass.armLabel, sourceClass.track),
    );
    if (!targetClass) continue;
    if (!activeTeacherIds.has(assignment.teacherMembershipId)) {
      skip(assignment.teacherMembershipId, "MEMBERSHIP_INACTIVE");
      continue;
    }
    const sourceOffering = sourceOfferingById.get(assignment.classSubjectId);
    if (!sourceOffering) continue;
    const targetOfferingId = targetOfferingByClassSubject.get(
      `${targetClass.id}:${sourceOffering.subjectId}`,
    );
    if (!targetOfferingId) continue;

    const inserted = await tx
      .insert(subjectTeacherAssignments)
      .values({
        schoolId: actor.schoolId,
        classId: targetClass.id,
        classSubjectId: targetOfferingId,
        teacherMembershipId: assignment.teacherMembershipId,
      })
      .onConflictDoNothing()
      .returning({ id: subjectTeacherAssignments.id });
    subjectAssignmentsCopied += inserted.length;
  }

  return {
    formAssignmentsCopied,
    subjectAssignmentsCopied,
    skippedTeachers,
  };
}
