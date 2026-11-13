import {
  and,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import type { DbExecutor } from "../../../db/types.js";
import {
  classes,
  classEnrollments,
  classSubjects,
  studentProfiles,
  studentSubjects,
  subjects,
  users,
  memberships,
} from "../../../db/schema/index.js";
import { AppError } from "../../../shared/lib/errors.js";
import { can, type Actor } from "../../rbac/can.js";
import {
  computeSelection,
  type ElectiveGroup,
  type ElectiveOffering,
  type SelectionProblem,
} from "./selection.js";

export interface RosterSubject {
  offeringId: string | null;
  subjectId: string;
  code: string;
  name: string;
  isCompulsory: boolean;
  electiveGroupId: string | null;
}

export interface RosterStudent {
  enrollmentId: string;
  studentId: string;
  membershipId: string;
  firstName: string;
  lastName: string;
  admissionNumber: string;
  subjects: RosterSubject[];
  complete: boolean;
  problems: SelectionProblem[];
}

export interface ClassRoster {
  classId: string;
  students: RosterStudent[];
}

interface RawGroup {
  id: string;
  name: string;
  minChoices: number;
  maxChoices: number;
}

interface RawOffering {
  id: string;
  groupId: string | null;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Class roster read model.
 *
 * Exactly TWO top-level queries regardless of class size:
 *   1. one page of active enrollments, with class elective groups/offerings
 *      attached as JSON (the class-level rules are identical for every row);
 *   2. all active student_subjects for those enrollment IDs.
 *
 * Subjects are grouped by enrollment in memory. There is deliberately no
 * query inside the student loop — that is the N+1 bug this endpoint exists to
 * avoid.
 */
export async function getClassRoster(
  executor: DbExecutor,
  actor: Actor,
  input: { classId: string; limit?: number; offset?: number },
): Promise<ClassRoster> {
  if (!can(actor, "enrollments:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot read this class roster");
  }
  if (
    !can(actor, "enrollments:read", {
      schoolId: actor.schoolId,
      classId: input.classId,
    })
  ) {
    throw new AppError(404, "CLASS_NOT_FOUND", "Class not found in this school");
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);

  const groupsJson = sql<unknown>`(
    select coalesce(
      json_agg(json_build_object(
        'id', g.id,
        'name', g.name,
        'minChoices', g.min_choices,
        'maxChoices', g.max_choices
      ) order by g.name),
      '[]'::json
    )
    from elective_groups g
    where g.school_id = ${actor.schoolId}
      and g.class_id = ${input.classId}
      and g.archived_at is null
  )`;

  const offeringsJson = sql<unknown>`(
    select coalesce(
      json_agg(json_build_object(
        'id', o.id,
        'groupId', o.elective_group_id
      ) order by o.id),
      '[]'::json
    )
    from class_subjects o
    where o.school_id = ${actor.schoolId}
      and o.class_id = ${input.classId}
      and o.is_compulsory = false
      and o.archived_at is null
  )`;

  // Query 1 — class existence + one page of active enrollments.
  // Groups/offerings are scalar subqueries, so they do not add a round trip.
  const page = await executor
    .select({
      classId: classes.id,
      enrollmentId: classEnrollments.id,
      studentId: studentProfiles.id,
      membershipId: studentProfiles.membershipId,
      firstName: users.firstName,
      lastName: users.lastName,
      admissionNumber: studentProfiles.admissionNumber,
      groups: groupsJson,
      offerings: offeringsJson,
    })
    .from(classes)
    .leftJoin(
      classEnrollments,
      and(
        eq(classEnrollments.classId, classes.id),
        eq(classEnrollments.schoolId, classes.schoolId),
        eq(classEnrollments.status, "active"),
        isNull(classEnrollments.endedAt),
      ),
    )
    .leftJoin(
      studentProfiles,
      and(
        eq(studentProfiles.id, classEnrollments.studentId),
        eq(studentProfiles.schoolId, classes.schoolId),
      ),
    )
    .leftJoin(
      memberships,
      and(
        eq(memberships.id, studentProfiles.membershipId),
        eq(memberships.schoolId, classes.schoolId),
      ),
    )
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(classes.id, input.classId),
        eq(classes.schoolId, actor.schoolId),
      ),
    )
    .orderBy(sql`${studentProfiles.admissionNumber} asc nulls last`)
    .limit(limit)
    .offset(offset);

  if (page.length === 0) {
    throw new AppError(
      404,
      "CLASS_NOT_FOUND",
      "Class not found in this school",
    );
  }

  const groups = asArray<RawGroup>(page[0]!.groups).map(
    (g): ElectiveGroup => ({
      id: g.id,
      name: g.name,
      minChoices: g.minChoices,
      maxChoices: g.maxChoices,
    }),
  );
  const offerings = asArray<RawOffering>(page[0]!.offerings).map(
    (o): ElectiveOffering => ({
      id: o.id,
      groupId: o.groupId,
    }),
  );

  const enrollmentRows = page.filter(
    (
      row,
    ): row is typeof row & {
      enrollmentId: string;
      studentId: string;
      membershipId: string;
    } =>
      row.enrollmentId !== null &&
      row.studentId !== null &&
      row.membershipId !== null,
  );

  const enrollmentIds = enrollmentRows.map((row) => row.enrollmentId);

  // Query 2 — all active subjects for the page, one query. If the page is
  // empty there is nothing to fetch and we skip it.
  const subjectRows =
    enrollmentIds.length === 0
      ? []
      : await executor
          .select({
            enrollmentId: studentSubjects.enrollmentId,
            offeringId: studentSubjects.classSubjectId,
            subjectId: classSubjects.subjectId,
            code: subjects.code,
            name: subjects.name,
            isCompulsory: classSubjects.isCompulsory,
            electiveGroupId: classSubjects.electiveGroupId,
          })
          .from(studentSubjects)
          .innerJoin(
            classSubjects,
            eq(classSubjects.id, studentSubjects.classSubjectId),
          )
          .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
          .where(
            and(
              inArray(studentSubjects.enrollmentId, enrollmentIds),
              isNull(studentSubjects.droppedAt),
            ),
          );

  const subjectsByEnrollment = new Map<string, RosterSubject[]>();
  for (const row of subjectRows) {
    const list = subjectsByEnrollment.get(row.enrollmentId) ?? [];
    list.push({
      offeringId: row.offeringId,
      subjectId: row.subjectId,
      code: row.code,
      name: row.name,
      isCompulsory: row.isCompulsory,
      electiveGroupId: row.electiveGroupId,
    });
    subjectsByEnrollment.set(row.enrollmentId, list);
  }

  const students = enrollmentRows.map((row): RosterStudent => {
    const studentSubjects = subjectsByEnrollment.get(row.enrollmentId) ?? [];
    const chosen = studentSubjects
      .filter(
        (s): s is RosterSubject & { offeringId: string } =>
          s.offeringId !== null && !s.isCompulsory,
      )
      .map((s) => ({ offeringId: s.offeringId }));

    const selection = computeSelection({ groups, offerings, chosen });

    return {
      enrollmentId: row.enrollmentId,
      studentId: row.studentId,
      membershipId: row.membershipId,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      admissionNumber: row.admissionNumber ?? "",
      subjects: studentSubjects,
      complete: selection.complete,
      problems: selection.problems,
    };
  });

  return { classId: input.classId, students };
}
