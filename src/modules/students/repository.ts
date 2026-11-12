import { studentProfiles, type StudentProfile } from "../../db/schema/student-profiles.js";
import type { DbExecutor } from "../../db/types.js";
import { AppError } from "../../shared/lib/errors.js";
import { isUniqueViolation } from "../../shared/errors/pg-errors.js";
import { one } from "../../shared/utils/assert.js";

export async function insertStudentProfile(
  executor: DbExecutor,
  data: {
    schoolId: string;
    membershipId: string;
    admissionNumber: string;
    house?: string | undefined;
    admissionDate?: string | undefined;
  },
): Promise<StudentProfile> {
  try {
    return one(
      await executor
        .insert(studentProfiles)
        .values({
          schoolId: data.schoolId,
          membershipId: data.membershipId,
          admissionNumber: data.admissionNumber,
          house: data.house ?? null,
          admissionDate: data.admissionDate ?? null,
        })
        .returning(),
    );
  } catch (err) {
    if (isUniqueViolation(err, "student_profiles_school_admission_uq")) {
      throw new AppError(
        409,
        "ADMISSION_NUMBER_TAKEN",
        `Admission number "${data.admissionNumber}" is already in use at this school`,
      );
    }
    if (isUniqueViolation(err, "student_profiles_school_membership_uq")) {
      throw new AppError(
        409,
        "STUDENT_PROFILE_EXISTS",
        "This member already has a student profile at this school",
      );
    }
    throw err;
  }
}
