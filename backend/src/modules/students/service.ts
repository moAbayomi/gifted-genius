import type { Tx, DbExecutor } from "../../db/types.js";
import type { StudentProfile } from "../../db/schema/student-profiles.js";
import { AppError } from "../../shared/lib/errors.js";
import { recordAudit } from "../../shared/audit/record.js";
import { can, type Actor, scopeFor } from "../rbac/can.js";
import {
  createMemberCore,
  type PrecomputedCredentials,
  type CreateMemberCoreResult,
} from "../users/create-member-core.js";
import * as repo from "./repository.js";
import { allocateAdmissionNumber } from "./admission-number.js";
import { generateStudentUsername } from "./username.js";
import type { CreateStudentInput } from "./schema.js";
import { currentSession } from "../academics/academic-sessions/service.js";
import type { PageQuery } from "../../shared/dto/pagination.js";
import type { ListStudentsQuery } from "./schema.js";

export interface CreateStudentResult extends CreateMemberCoreResult {
  student: StudentProfile;
}

/**
 * Create a student as a user + membership + student role + profile in one
 * transaction. The shared core owns role resolution, rank/permission checks,
 * temporary-password handling, membership creation, and audit; this function
 * only adds the profile.
 *
 * If the admission number is already taken, the profile insert throws inside
 * this transaction and PostgreSQL rolls back the user, membership, and role
 * assignment created by the core.
 */
export async function createStudent(
  tx: Tx,
  actor: Actor,
  input: CreateStudentInput,
  precomputed: PrecomputedCredentials,
): Promise<CreateStudentResult> {
  if (
    !can(actor, "users:create") &&
    !can(actor, "students:import")
  ) {
    throw new AppError(403, "FORBIDDEN", "Cannot create students");
  }

  const admissionNumber =
    input.admissionNumber?.trim() ??
    (await allocateAdmissionNumber(tx, actor.schoolId));
  const username = input.username ??
    (await generateStudentUsername(tx, actor.schoolId, {
      firstName: input.firstName,
      lastName: input.lastName,
      admissionNumber,
    }));

  const core = await createMemberCore(
    tx,
    actor,
    {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      username,
      roleKeys: ["student"],
    },
    precomputed,
    "POST /students",
  );

  const student = await repo.insertStudentProfile(tx, {
    schoolId: actor.schoolId,
    membershipId: core.membershipId,
    admissionNumber,
    house: input.house?.trim(),
    admissionDate: input.admissionDate,
  });

  await recordAudit(tx, {
    schoolId: actor.schoolId,
    actorMembershipId: actor.membershipId,
    action: "student.created",
    targetType: "student_profile",
    targetId: student.id,
    after: {
      membershipId: core.membershipId,
      admissionNumber: student.admissionNumber,
      house: student.house,
      admissionDate: student.admissionDate,
    },
  });

  return { ...core, student };
}

// ── Student directory ─────────────────────────────────────────────



export async function listStudents(
  executor: DbExecutor,
  actor: Actor,
  page: PageQuery,
  query: ListStudentsQuery,
): Promise<{ rows: repo.StudentListRow[]; total: number }> {
  if (!can(actor, "enrollments:read")) {
    throw new AppError(403, "FORBIDDEN", "Cannot read students");
  }

  const scope = scopeFor(actor, "enrollments:read");
  let classIds: string[] | undefined;
  let sessionId: string | null = null;

  if (query.classId) {
    if (!(await repo.classBelongsToSchool(executor, actor.schoolId, query.classId))) {
      throw new AppError(404, "CLASS_NOT_FOUND", "Class not found");
    }
    if (scope !== "all" && !scope.has(query.classId)) {
      // Out-of-scope data must look exactly like missing data.
      throw new AppError(404, "CLASS_NOT_FOUND", "Class not found");
    }
    classIds = [query.classId];
  } else {
    const session = await currentSession(executor, actor, {
      allowWithoutAcademicsRead: true,
    });
    sessionId = session?.id ?? null;

    if (scope !== "all") {
      classIds = [...scope];
      if (classIds.length === 0) return { rows: [], total: 0 };
      if (!sessionId) return { rows: [], total: 0 };
    }
  }

  return repo.listStudents(executor, {
    schoolId: actor.schoolId,
    classIds,
    sessionId,
    q: query.q,
    limit: page.limit,
    offset: page.offset,
  });
}
