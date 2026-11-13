import type { Class } from "../../../db/schema/classes.js";
import type { SubjectTeacherAssignment } from "../../../db/schema/subject-teacher-assignments.js";

export interface FormTeacherDto {
  classId: string;
  formTeacherMembershipId: string | null;
}

export function toFormTeacherDto(cls: Class): FormTeacherDto {
  return {
    classId: cls.id,
    formTeacherMembershipId: cls.formTeacherMembershipId,
  };
}

export interface SubjectTeacherAssignmentDto {
  id: string;
  classId: string;
  classSubjectId: string;
  teacherMembershipId: string;
  assignedAt: string;
  endedAt: string | null;
}

export function toSubjectTeacherAssignmentDto(
  row: SubjectTeacherAssignment,
): SubjectTeacherAssignmentDto {
  return {
    id: row.id,
    classId: row.classId,
    classSubjectId: row.classSubjectId,
    teacherMembershipId: row.teacherMembershipId,
    assignedAt: row.assignedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}
