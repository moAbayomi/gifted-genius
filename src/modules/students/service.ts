import type { Tx } from "../../db/types.js";
import type { StudentProfile } from "../../db/schema/student-profiles.js";
import { AppError } from "../../shared/lib/errors.js";
import { recordAudit } from "../../shared/audit/record.js";
import { can, type Actor } from "../rbac/can.js";
import {
  createMemberCore,
  type PrecomputedCredentials,
  type CreateMemberCoreResult,
} from "../users/create-member-core.js";
import * as repo from "./repository.js";
import type { CreateStudentInput } from "./schema.js";

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
  if (!can(actor, "users:create")) {
    throw new AppError(403, "FORBIDDEN", "Cannot create students");
  }
  if (!input.email && !input.username) {
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "A student without an email must have a username",
    );
  }

  const core = await createMemberCore(
    tx,
    actor,
    {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      username: input.username,
      roleKeys: ["student"],
    },
    precomputed,
    "POST /students",
  );

  const student = await repo.insertStudentProfile(tx, {
    schoolId: actor.schoolId,
    membershipId: core.membershipId,
    admissionNumber: input.admissionNumber.trim(),
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
