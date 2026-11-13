import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../../db/types.js";
import { classSubjects } from "../../../db/schema/class-subjects.js";
import { memberships } from "../../../db/schema/memberships.js";
import { membershipRoles } from "../../../db/schema/membership-roles.js";
import { roles } from "../../../db/schema/roles.js";
import {
  subjectTeacherAssignments,
  type SubjectTeacherAssignment,
} from "../../../db/schema/subject-teacher-assignments.js";

export async function findMembershipKind(
  executor: DbExecutor,
  schoolId: string,
  membershipId: string,
): Promise<{ membershipId: string; status: string; kinds: string[] } | null> {
  const rows = await executor
    .select({
      membershipId: memberships.id,
      status: memberships.status,
      kind: roles.kind,
    })
    .from(memberships)
    .leftJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
    .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(
      and(
        eq(memberships.id, membershipId),
        eq(memberships.schoolId, schoolId),
      ),
    );
  const first = rows[0];
  if (!first) return null;
  return {
    membershipId: first.membershipId,
    status: first.status,
    kinds: rows.flatMap((r) => (r.kind ? [r.kind] : [])),
  };
}

export async function findOffering(
  executor: DbExecutor,
  schoolId: string,
  id: string,
) {
  const [row] = await executor
    .select()
    .from(classSubjects)
    .where(and(eq(classSubjects.schoolId, schoolId), eq(classSubjects.id, id)))
    .limit(1);
  return row ?? null;
}

export async function lockOffering(
  executor: DbExecutor,
  schoolId: string,
  id: string,
) {
  const [row] = await executor
    .select()
    .from(classSubjects)
    .where(and(eq(classSubjects.schoolId, schoolId), eq(classSubjects.id, id)))
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function listActiveAssignmentsForOffering(
  executor: DbExecutor,
  schoolId: string,
  classSubjectId: string,
): Promise<SubjectTeacherAssignment[]> {
  return executor
    .select()
    .from(subjectTeacherAssignments)
    .where(
      and(
        eq(subjectTeacherAssignments.schoolId, schoolId),
        eq(subjectTeacherAssignments.classSubjectId, classSubjectId),
        isNull(subjectTeacherAssignments.endedAt),
      ),
    );
}

export async function endActiveAssignmentsForOffering(
  executor: DbExecutor,
  schoolId: string,
  classSubjectId: string,
): Promise<SubjectTeacherAssignment[]> {
  return executor
    .update(subjectTeacherAssignments)
    .set({ endedAt: new Date() })
    .where(
      and(
        eq(subjectTeacherAssignments.schoolId, schoolId),
        eq(subjectTeacherAssignments.classSubjectId, classSubjectId),
        isNull(subjectTeacherAssignments.endedAt),
      ),
    )
    .returning();
}

export async function insertAssignment(
  executor: DbExecutor,
  data: {
    schoolId: string;
    classId: string;
    classSubjectId: string;
    teacherMembershipId: string;
  },
): Promise<SubjectTeacherAssignment> {
  const [row] = await executor
    .insert(subjectTeacherAssignments)
    .values(data)
    .returning();
  return row!;
}
