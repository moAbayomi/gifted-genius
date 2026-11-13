import type { Tx } from "../../../db/types.js";
import type { Class } from "../../../db/schema/classes.js";
import type { SubjectTeacherAssignment } from "../../../db/schema/subject-teacher-assignments.js";
import { AppError } from "../../../shared/lib/errors.js";
import { recordAudit } from "../../../shared/audit/record.js";
import { can, type Actor } from "../../rbac/can.js";
import { lockSchoolRow } from "../../roles/repository.js";
import * as classRepo from "../classes/repository.js";
import { assertSessionOpen } from "../session-guard.js";
import * as repo from "./repository.js";

async function requireStaff(
  tx: Tx,
  actor: Actor,
  teacherMembershipId: string,
): Promise<void> {
  const member = await repo.findMembershipKind(
    tx,
    actor.schoolId,
    teacherMembershipId,
  );
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
  }
  if (member.status !== "active") {
    throw new AppError(403, "MEMBER_INACTIVE", "Member is not active");
  }
  if (!member.kinds.includes("staff")) {
    throw new AppError(
      403,
      "TEACHER_NOT_STAFF",
      "Only staff-kind members can be assigned as teachers",
    );
  }
}

async function loadOpenClass(tx: Tx, actor: Actor, classId: string): Promise<Class> {
  await lockSchoolRow(tx, actor.schoolId);
  const initial = await classRepo.findClass(tx, actor.schoolId, classId);
  if (!initial) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Class not found in this school");
  }
  await assertSessionOpen(tx, actor.schoolId, initial.sessionId);
  const cls = await classRepo.lockClass(tx, actor.schoolId, classId);
  if (!cls) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Class not found in this school");
  }
  if (cls.archivedAt !== null) {
    throw new AppError(409, "CLASS_ARCHIVED", "Class is archived");
  }
  return cls;
}

export async function assignFormTeacher(
  tx: Tx,
  actor: Actor,
  input: { classId: string; teacherMembershipId: string },
): Promise<Class> {
  if (!can(actor, "assignments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot assign teachers");
  }
  await requireStaff(tx, actor, input.teacherMembershipId);
  const cls = await loadOpenClass(tx, actor, input.classId);

  if (cls.formTeacherMembershipId === input.teacherMembershipId) {
    return cls;
  }
  const [updated] = await tx
    .update((await import("../../../db/schema/classes.js")).classes)
    .set({ formTeacherMembershipId: input.teacherMembershipId })
    .where((await import("drizzle-orm")).eq((await import("../../../db/schema/classes.js")).classes.id, cls.id))
    .returning();

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: cls.formTeacherMembershipId
      ? "class.form_teacher_replaced"
      : "class.form_teacher_assigned",
    targetType: "class",
    targetId: cls.id,
    before: { formTeacherMembershipId: cls.formTeacherMembershipId },
    after: { formTeacherMembershipId: input.teacherMembershipId },
  });
  return updated!;
}

export async function replaceSubjectTeacher(
  tx: Tx,
  actor: Actor,
  input: { classSubjectId: string; teacherMembershipId: string },
): Promise<SubjectTeacherAssignment> {
  if (!can(actor, "assignments:manage")) {
    throw new AppError(403, "FORBIDDEN", "Cannot assign teachers");
  }
  const meta = await repo.findOffering(tx, actor.schoolId, input.classSubjectId);
  if (!meta) {
    throw new AppError(404, "OFFERING_NOT_FOUND", "Offering not found");
  }
  await requireStaff(tx, actor, input.teacherMembershipId);
  const cls = await loadOpenClass(tx, actor, meta.classId);
  const offering = await repo.lockOffering(tx, actor.schoolId, input.classSubjectId);
  if (!offering || offering.classId !== cls.id) {
    throw new AppError(404, "OFFERING_NOT_FOUND", "Offering not found in this class");
  }

  const active = await repo.listActiveAssignmentsForOffering(
    tx,
    actor.schoolId,
    offering.id,
  );
  const same = active.find(
    (a) => a.teacherMembershipId === input.teacherMembershipId,
  );
  if (same) return same;

  const ended = await repo.endActiveAssignmentsForOffering(
    tx,
    actor.schoolId,
    offering.id,
  );
  const created = await repo.insertAssignment(tx, {
    schoolId: actor.schoolId,
    classId: cls.id,
    classSubjectId: offering.id,
    teacherMembershipId: input.teacherMembershipId,
  });

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "subject_teacher.replaced",
    targetType: "class_subject",
    targetId: offering.id,
    before: { teacherMembershipIds: ended.map((a) => a.teacherMembershipId) },
    after: { teacherMembershipId: created.teacherMembershipId },
  });
  return created;
}
