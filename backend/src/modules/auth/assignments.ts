import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import { academicSessions } from "../../db/schema/academic-sessions.js";
import { classes } from "../../db/schema/classes.js";
import { classSubjects } from "../../db/schema/class-subjects.js";
import { levels } from "../../db/schema/levels.js";
import { subjects } from "../../db/schema/subjects.js";
import { AppError } from "../../shared/lib/errors.js";
import type { Actor } from "../rbac/can.js";
import { loadScope } from "../rbac/scope.js";
import { findMembershipKind } from "../academics/assignments/repository.js";

export interface MeAssignments {
  session: { id: string; label: string } | null;
  formTeacherClasses: Array<{
    id: string;
    levelName: string;
    armLabel: string;
    track: string;
    displayName: string;
  }>;
  subjectOfferings: Array<{
    id: string;
    classId: string;
    className: string;
    subject: { id: string; code: string; name: string };
  }>;
}

export async function getMyAssignments(
  executor: DbExecutor,
  actor: Actor,
): Promise<MeAssignments> {
  const member = await findMembershipKind(
    executor,
    actor.schoolId,
    actor.membershipId,
  );
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
  }
  if (!member.kinds.includes("staff")) {
    throw new AppError(
      403,
      "STAFF_ONLY",
      "Only staff members can view assignments",
    );
  }

  const scope = await loadScope(executor, actor);
  const session = scope.sessionId
    ? (await executor
        .select({ id: academicSessions.id, label: academicSessions.label })
        .from(academicSessions)
        .where(
          and(
            eq(academicSessions.id, scope.sessionId),
            eq(academicSessions.schoolId, actor.schoolId),
          ),
        )
        .limit(1))[0] ?? null
    : null;

  const formTeacherClasses =
    scope.formTeacherClassIds.length === 0
      ? []
      : await executor
          .select({
            id: classes.id,
            levelName: levels.name,
            armLabel: classes.armLabel,
            track: classes.track,
          })
          .from(classes)
          .innerJoin(levels, eq(levels.id, classes.levelId))
          .where(
            and(
              eq(classes.schoolId, actor.schoolId),
              inArray(classes.id, scope.formTeacherClassIds),
            ),
          );

  const subjectOfferings =
    scope.offeringIds.length === 0
      ? []
      : await executor
          .select({
            id: classSubjects.id,
            classId: classes.id,
            levelName: levels.name,
            armLabel: classes.armLabel,
            subjectId: subjects.id,
            subjectCode: subjects.code,
            subjectName: subjects.name,
          })
          .from(classSubjects)
          .innerJoin(classes, eq(classes.id, classSubjects.classId))
          .innerJoin(levels, eq(levels.id, classes.levelId))
          .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId))
          .where(
            and(
              eq(classSubjects.schoolId, actor.schoolId),
              inArray(classSubjects.id, scope.offeringIds),
            ),
          );

  return {
    session,
    formTeacherClasses: formTeacherClasses.map((c) => ({
      ...c,
      displayName: `${c.levelName} ${c.armLabel}`,
    })),
    subjectOfferings: subjectOfferings.map((o) => ({
      id: o.id,
      classId: o.classId,
      className: `${o.levelName} ${o.armLabel}`,
      subject: {
        id: o.subjectId,
        code: o.subjectCode,
        name: o.subjectName,
      },
    })),
  };
}
