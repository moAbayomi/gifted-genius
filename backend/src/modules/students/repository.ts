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

// ── Student directory ─────────────────────────────────────────────

import {
  and,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  classEnrollments,
  classes,
  levels,
  memberships,
  users,
} from "../../db/schema/index.js";

export interface StudentListRow {
  id: string;
  membershipId: string;
  enrollmentId: string | null;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  house: string | null;
  admissionDate: string | null;
  membershipStatus: "active" | "inactive" | "suspended";
  classId: string | null;
  levelName: string | null;
  armLabel: string | null;
  track: "general" | "science" | "arts" | "commercial" | null;
}

export interface StudentListFilters {
  schoolId: string;
  classIds: string[] | undefined;
  sessionId: string | null;
  q: string | undefined;
  limit: number;
  offset: number;
}

const studentListColumns = {
  id: studentProfiles.id,
  membershipId: studentProfiles.membershipId,
  enrollmentId: classEnrollments.id,
  admissionNumber: studentProfiles.admissionNumber,
  firstName: users.firstName,
  lastName: users.lastName,
  email: users.email,
  username: memberships.username,
  house: studentProfiles.house,
  admissionDate: studentProfiles.admissionDate,
  membershipStatus: memberships.status,
  classId: classes.id,
  levelName: levels.name,
  armLabel: classes.armLabel,
  track: classes.track,
};

function studentSearch(filters: StudentListFilters) {
  if (!filters.q) return undefined;
  const term = `%${filters.q}%`;
  return or(
    ilike(users.firstName, term),
    ilike(users.lastName, term),
    ilike(users.email, term),
    ilike(memberships.username, term),
    ilike(studentProfiles.admissionNumber, term),
  );
}

function studentWhere(filters: StudentListFilters) {
  return and(
    eq(studentProfiles.schoolId, filters.schoolId),
    studentSearch(filters),
  );
}

function enrollmentJoin(filters: StudentListFilters) {
  const parts = [
    eq(classEnrollments.studentId, studentProfiles.id),
    eq(classEnrollments.schoolId, filters.schoolId),
    eq(classEnrollments.status, "active"),
    isNull(classEnrollments.endedAt),
  ];
  if (filters.classIds) {
    parts.push(inArray(classEnrollments.classId, filters.classIds));
  }
  if (filters.sessionId) {
    parts.push(eq(classEnrollments.sessionId, filters.sessionId));
  } else if (!filters.classIds) {
    parts.push(sql`false`);
  }
  return and(...parts);
}

export async function listStudents(
  executor: DbExecutor,
  filters: StudentListFilters,
): Promise<{ rows: StudentListRow[]; total: number }> {
  const scoped = (filters.classIds?.length ?? 0) > 0;
  const base = executor
    .select(studentListColumns)
    .from(studentProfiles)
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, studentProfiles.membershipId),
        eq(memberships.schoolId, filters.schoolId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId));

  const joined = scoped
    ? base.innerJoin(classEnrollments, enrollmentJoin(filters))
    : base.leftJoin(classEnrollments, enrollmentJoin(filters));

  const rows = await joined
    .leftJoin(classes, eq(classes.id, classEnrollments.classId))
    .leftJoin(levels, eq(levels.id, classes.levelId))
    .where(studentWhere(filters))
    .orderBy(users.lastName, users.firstName, studentProfiles.admissionNumber)
    .limit(filters.limit)
    .offset(filters.offset);

  const countBase = executor
    .select({ total: count() })
    .from(studentProfiles)
    .innerJoin(
      memberships,
      and(
        eq(memberships.id, studentProfiles.membershipId),
        eq(memberships.schoolId, filters.schoolId),
      ),
    )
    .innerJoin(users, eq(users.id, memberships.userId));

  const countJoined = scoped
    ? countBase.innerJoin(classEnrollments, enrollmentJoin(filters))
    : countBase.leftJoin(classEnrollments, enrollmentJoin(filters));

  const [totalRow] = await countJoined.where(studentWhere(filters));
  return { rows, total: totalRow?.total ?? 0 };
}

export async function classBelongsToSchool(
  executor: DbExecutor,
  schoolId: string,
  classId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.schoolId, schoolId), eq(classes.id, classId)))
    .limit(1);
  return row !== undefined;
}
