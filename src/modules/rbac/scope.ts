import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import { classes } from "../../db/schema/classes.js";
import { subjectTeacherAssignments } from "../../db/schema/subject-teacher-assignments.js";
import { currentSession } from "../academics/academic-sessions/service.js";
import type { Actor } from "./can.js";

export interface ActorScope {
  /** Current academic session used to load this scope, if any. */
  sessionId: string | null;
  /** Classes the actor is enrolled in as a student (active enrolments). */
  classIds: string[];
  /** Classes where the actor is the form teacher. */
  formTeacherClassIds: string[];
  /** Offerings the actor actively teaches. */
  offeringIds: string[];
}

export const EMPTY_SCOPE: ActorScope = Object.freeze({
  sessionId: null,
  classIds: [],
  formTeacherClassIds: [],
  offeringIds: [],
});

/**
 * Load the request-time scope for an actor.
 *
 * This is deliberately loaded on every request rather than stored in the
 * session: an admin reassignment must take effect on the next request.
 *
 * Two queries after resolving the current session: one class-scope query
 * (form teacher or active student enrolment) and one offering query.
 */
export async function loadScope(
  executor: DbExecutor,
  actor: Actor,
): Promise<ActorScope> {
  const session = await currentSession(executor, actor, {
    allowWithoutAcademicsRead: true,
  });
  if (!session) return EMPTY_SCOPE;

  const classRows = await executor
    .select({
      id: classes.id,
      isForm: sql<boolean>`${classes.formTeacherMembershipId} = ${actor.membershipId}`,
      isEnrolled: sql<boolean>`exists (
        select 1
        from class_enrollments e
        join student_profiles sp on sp.id = e.student_id
        where e.class_id = "classes"."id"
          and e.session_id = ${session.id}
          and e.school_id = ${actor.schoolId}
          and e.status = 'active'
          and e.ended_at is null
          and sp.membership_id = ${actor.membershipId}
      )`,
    })
    .from(classes)
    .where(
      and(
        eq(classes.schoolId, actor.schoolId),
        eq(classes.sessionId, session.id),
        or(
          eq(classes.formTeacherMembershipId, actor.membershipId),
          sql`exists (
            select 1
            from class_enrollments e
            join student_profiles sp on sp.id = e.student_id
            where e.class_id = "classes"."id"
              and e.session_id = ${session.id}
              and e.school_id = ${actor.schoolId}
              and e.status = 'active'
              and e.ended_at is null
              and sp.membership_id = ${actor.membershipId}
          )`,
        ),
      ),
    );

  const offeringRows = await executor
    .select({ id: subjectTeacherAssignments.classSubjectId })
    .from(subjectTeacherAssignments)
    .innerJoin(classes, eq(classes.id, subjectTeacherAssignments.classId))
    .where(
      and(
        eq(subjectTeacherAssignments.schoolId, actor.schoolId),
        eq(subjectTeacherAssignments.teacherMembershipId, actor.membershipId),
        isNull(subjectTeacherAssignments.endedAt),
        eq(classes.sessionId, session.id),
      ),
    );

  return {
    sessionId: session.id,
    classIds: classRows.filter((r) => r.isEnrolled).map((r) => r.id),
    formTeacherClassIds: classRows.filter((r) => r.isForm).map((r) => r.id),
    offeringIds: offeringRows.map((r) => r.id),
  };
}
