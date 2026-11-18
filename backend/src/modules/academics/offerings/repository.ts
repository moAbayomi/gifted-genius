import { and, eq, isNull } from "drizzle-orm";
import {
  classSubjects,
  type ClassSubject,
} from "../../../db/schema/class-subjects.js";
import { subjects, type Subject } from "../../../db/schema/subjects.js";
import { studentSubjects } from "../../../db/schema/student-subjects.js";
import type { DbExecutor } from "../../../db/types.js";

export interface OfferingWithSubject extends ClassSubject {
  subject: Pick<Subject, "id" | "code" | "name">;
}

/**
 * Archive-guard queries. An offering is "active" while archived_at is null.
 * These helpers are school-scoped so another school's data cannot block an
 * archive, and an already-archived offering does not block it.
 */
async function hasActiveOfferingRow(
  executor: DbExecutor,
  schoolId: string,
  extra: ReturnType<typeof eq>[],
): Promise<boolean> {
  const [row] = await executor
    .select({ id: classSubjects.id })
    .from(classSubjects)
    .where(
      and(
        eq(classSubjects.schoolId, schoolId),
        isNull(classSubjects.archivedAt),
        ...extra,
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function classHasOfferings(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<boolean> {
  return hasActiveOfferingRow(executor, schoolId, [
    eq(classSubjects.classId, classId),
  ]);
}

export async function subjectHasOfferings(
  executor: DbExecutor,
  schoolId: string,
  subjectId: string,
): Promise<boolean> {
  return hasActiveOfferingRow(executor, schoolId, [
    eq(classSubjects.subjectId, subjectId),
  ]);
}

export async function electiveGroupHasOfferings(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
  groupId: string,
): Promise<boolean> {
  return hasActiveOfferingRow(executor, schoolId, [
    eq(classSubjects.classId, classId),
    eq(classSubjects.electiveGroupId, groupId),
  ]);
}

/** Full offering shape for reads and responses. */
const offeringWithSubjectColumns = {
  id: classSubjects.id,
  schoolId: classSubjects.schoolId,
  classId: classSubjects.classId,
  subjectId: classSubjects.subjectId,
  electiveGroupId: classSubjects.electiveGroupId,
  isCompulsory: classSubjects.isCompulsory,
  archivedAt: classSubjects.archivedAt,
  createdAt: classSubjects.createdAt,
  updatedAt: classSubjects.updatedAt,
  subject: {
    id: subjects.id,
    code: subjects.code,
    name: subjects.name,
  },
} as const;

export async function findClassSubjectById(
  executor: DbExecutor,
  schoolId: string,
  id: string,
): Promise<ClassSubject | null> {
  const [row] = await executor
    .select()
    .from(classSubjects)
    .where(
      and(eq(classSubjects.schoolId, schoolId), eq(classSubjects.id, id)),
    )
    .limit(1);
  return row ?? null;
}

export async function lockClassSubject(
  executor: DbExecutor,
  schoolId: string,
  id: string,
): Promise<ClassSubject | null> {
  const [row] = await executor
    .select()
    .from(classSubjects)
    .where(
      and(eq(classSubjects.schoolId, schoolId), eq(classSubjects.id, id)),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function listClassSubjects(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
  includeArchived: boolean,
): Promise<OfferingWithSubject[]> {
  const where = includeArchived
    ? and(
        eq(classSubjects.schoolId, schoolId),
        eq(classSubjects.classId, classId),
      )
    : and(
        eq(classSubjects.schoolId, schoolId),
        eq(classSubjects.classId, classId),
        isNull(classSubjects.archivedAt),
      );

  return executor
    .select(offeringWithSubjectColumns)
    .from(classSubjects)
    .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
    .where(where)
    .orderBy(subjects.code);
}

export async function deleteStudentSubjectsForOffering(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
  classSubjectId: string,
): Promise<number> {
  const deleted = await executor
    .delete(studentSubjects)
    .where(
      and(
        eq(studentSubjects.schoolId, schoolId),
        eq(studentSubjects.classId, classId),
        eq(studentSubjects.classSubjectId, classSubjectId),
      ),
    )
    .returning({ id: studentSubjects.id });
  return deleted.length;
}

export async function deleteClassSubject(
  executor: DbExecutor,
  schoolId: string,
  id: string,
): Promise<void> {
  await executor
    .delete(classSubjects)
    .where(
      and(eq(classSubjects.schoolId, schoolId), eq(classSubjects.id, id)),
    );
}
