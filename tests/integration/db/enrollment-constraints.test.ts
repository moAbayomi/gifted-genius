import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { one } from "../../../src/shared/utils/assert.js";
import {
  schools,
  users,
  memberships,
  academicSessions,
  levels,
  classes,
  subjects,
  electiveGroups,
  studentProfiles,
  classSubjects,
  classEnrollments,
  studentSubjects,
} from "../../../src/db/schema/index.js";

function hasPgConstraint(err: unknown, constraintName: string): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const e = current as { constraint?: string; cause?: unknown };
    if (e.constraint === constraintName) return true;
    current = e.cause;
  }
  return false;
}

async function expectConstraintViolation(
  promise: Promise<unknown>,
  constraintName: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  if (caught === undefined) {
    throw new Error(
      `Expected constraint violation on "${constraintName}", but query succeeded`,
    );
  }
  if (!hasPgConstraint(caught, constraintName)) {
    const err = caught as Error;
    throw new Error(
      `Expected constraint "${constraintName}", got: ${err.message}`,
    );
  }
}

describe("database constraints — enrollment tables", () => {
  let schoolA: typeof schools.$inferSelect;
  let schoolB: typeof schools.$inferSelect;
  let sessionA: typeof academicSessions.$inferSelect;
  let sessionB: typeof academicSessions.$inferSelect;
  let levelA: typeof levels.$inferSelect;
  let levelB: typeof levels.$inferSelect;
  let classA1: typeof classes.$inferSelect;
  let classA2: typeof classes.$inferSelect;
  let classB: typeof classes.$inferSelect;
  let subjectA1: typeof subjects.$inferSelect;
  let subjectA2: typeof subjects.$inferSelect;
  let subjectB: typeof subjects.$inferSelect;
  let profileA: typeof studentProfiles.$inferSelect;
  let profileB: typeof studentProfiles.$inferSelect;
  let groupA: typeof electiveGroups.$inferSelect;
  let csA1: typeof classSubjects.$inferSelect;
  let csA2: typeof classSubjects.$inferSelect;
  let csB: typeof classSubjects.$inferSelect;
  let enrollmentA1: typeof classEnrollments.$inferSelect;

  beforeEach(async () => {
    schoolA = one(
      await db
        .insert(schools)
        .values({ name: "School A", slug: "school-a" })
        .returning(),
    );
    schoolB = one(
      await db
        .insert(schools)
        .values({ name: "School B", slug: "school-b" })
        .returning(),
    );

    const userA = one(
      await db
        .insert(users)
        .values({ email: "student-a@test.local", firstName: "A", lastName: "Student" })
        .returning(),
    );
    const userB = one(
      await db
        .insert(users)
        .values({ email: "student-b@test.local", firstName: "B", lastName: "Student" })
        .returning(),
    );
    const membershipA = one(
      await db
        .insert(memberships)
        .values({ userId: userA.id, schoolId: schoolA.id })
        .returning(),
    );
    const membershipB = one(
      await db
        .insert(memberships)
        .values({ userId: userB.id, schoolId: schoolB.id })
        .returning(),
    );

    sessionA = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: schoolA.id, label: "2026/2027" })
        .returning(),
    );
    sessionB = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: schoolB.id, label: "2026/2027" })
        .returning(),
    );

    levelA = one(
      await db
        .insert(levels)
        .values({ schoolId: schoolA.id, name: "JSS 1", sequence: 1, stage: "junior" })
        .returning(),
    );
    levelB = one(
      await db
        .insert(levels)
        .values({ schoolId: schoolB.id, name: "JSS 1", sequence: 1, stage: "junior" })
        .returning(),
    );

    classA1 = one(
      await db
        .insert(classes)
        .values({
          schoolId: schoolA.id,
          sessionId: sessionA.id,
          levelId: levelA.id,
          armLabel: "A",
        })
        .returning(),
    );
    classA2 = one(
      await db
        .insert(classes)
        .values({
          schoolId: schoolA.id,
          sessionId: sessionA.id,
          levelId: levelA.id,
          armLabel: "B",
        })
        .returning(),
    );
    classB = one(
      await db
        .insert(classes)
        .values({
          schoolId: schoolB.id,
          sessionId: sessionB.id,
          levelId: levelB.id,
          armLabel: "A",
        })
        .returning(),
    );

    subjectA1 = one(
      await db
        .insert(subjects)
        .values({ schoolId: schoolA.id, code: "ENG", name: "English" })
        .returning(),
    );
    subjectA2 = one(
      await db
        .insert(subjects)
        .values({ schoolId: schoolA.id, code: "MTH", name: "Mathematics" })
        .returning(),
    );
    subjectB = one(
      await db
        .insert(subjects)
        .values({ schoolId: schoolB.id, code: "ENG", name: "English" })
        .returning(),
    );

    profileA = one(
      await db
        .insert(studentProfiles)
        .values({
          schoolId: schoolA.id,
          membershipId: membershipA.id,
          admissionNumber: "A-001",
        })
        .returning(),
    );
    profileB = one(
      await db
        .insert(studentProfiles)
        .values({
          schoolId: schoolB.id,
          membershipId: membershipB.id,
          admissionNumber: "B-001",
        })
        .returning(),
    );

    groupA = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: schoolA.id,
          classId: classA1.id,
          sessionId: sessionA.id,
          name: "Electives",
          minChoices: 1,
          maxChoices: 2,
        })
        .returning(),
    );

    csA1 = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: schoolA.id,
          classId: classA1.id,
          subjectId: subjectA1.id,
          electiveGroupId: groupA.id,
        })
        .returning(),
    );
    csA2 = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: schoolA.id,
          classId: classA1.id,
          subjectId: subjectA2.id,
        })
        .returning(),
    );
    csB = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: schoolB.id,
          classId: classB.id,
          subjectId: subjectB.id,
        })
        .returning(),
    );

    enrollmentA1 = one(
      await db
        .insert(classEnrollments)
        .values({
          schoolId: schoolA.id,
          studentId: profileA.id,
          classId: classA1.id,
          sessionId: sessionA.id,
          startedAt: new Date("2026-09-15T00:00:00Z"),
        })
        .returning(),
    );
  });

  it("subjects: duplicate code in a school is refused, same code in another school is allowed", async () => {
    await expectConstraintViolation(
      db
        .insert(subjects)
        .values({ schoolId: schoolA.id, code: "ENG", name: "English II" }),
      "subjects_school_code_uq",
    );
    // Control: School B already has ENG; another school may reuse it.
    await db
      .insert(subjects)
      .values({ schoolId: schoolB.id, code: "MTH", name: "Mathematics" });
  });

  it("student profiles: duplicate admission and membership/school are refused", async () => {
    // Same membership cannot hold two profiles in one school.
    await expectConstraintViolation(
      db.insert(studentProfiles).values({
        schoolId: schoolA.id,
        membershipId: profileA.membershipId,
        admissionNumber: "A-001",
      }),
      "student_profiles_school_membership_uq",
    );

    // A different member in the same school cannot reuse an admission number.
    const userC = one(
      await db
        .insert(users)
        .values({ email: "student-c@test.local", firstName: "C", lastName: "Student" })
        .returning(),
    );
    const membershipC = one(
      await db
        .insert(memberships)
        .values({ userId: userC.id, schoolId: schoolA.id })
        .returning(),
    );
    await expectConstraintViolation(
      db.insert(studentProfiles).values({
        schoolId: schoolA.id,
        membershipId: membershipC.id,
        admissionNumber: "A-001",
      }),
      "student_profiles_school_admission_uq",
    );

    // Membership from another school cannot be used in School A.
    await expectConstraintViolation(
      db.insert(studentProfiles).values({
        schoolId: schoolA.id,
        membershipId: profileB.membershipId,
        admissionNumber: "A-002",
      }),
      "student_profiles_membership_school_fk",
    );

    // Control: the same admission number is valid in another school.
    const userD = one(
      await db
        .insert(users)
        .values({ email: "student-d@test.local", firstName: "D", lastName: "Student" })
        .returning(),
    );
    const membershipD = one(
      await db
        .insert(memberships)
        .values({ userId: userD.id, schoolId: schoolB.id })
        .returning(),
    );
    await db.insert(studentProfiles).values({
      schoolId: schoolB.id,
      membershipId: membershipD.id,
      admissionNumber: "A-001",
    });
  });

  it("elective groups: min/max and class/session are checked", async () => {
    await expectConstraintViolation(
      db.insert(electiveGroups).values({
        schoolId: schoolA.id,
        classId: classA2.id,
        sessionId: sessionA.id,
        name: "Bad",
        minChoices: 3,
        maxChoices: 2,
      }),
      "elective_groups_max_choices_chk",
    );

    await expectConstraintViolation(
      db.insert(electiveGroups).values({
        schoolId: schoolA.id,
        classId: classA2.id,
        sessionId: sessionB.id,
        name: "Wrong session",
        minChoices: 1,
        maxChoices: 2,
      }),
      "elective_groups_class_session_fk",
    );

    // Control: a valid group on the other class.
    await db.insert(electiveGroups).values({
      schoolId: schoolA.id,
      classId: classA2.id,
      sessionId: sessionA.id,
      name: "Valid",
      minChoices: 0,
      maxChoices: 1,
    });
  });

  it("class subjects: duplicate offering and cross-school subject are refused", async () => {
    await expectConstraintViolation(
      db.insert(classSubjects).values({
        schoolId: schoolA.id,
        classId: classA1.id,
        subjectId: subjectA1.id,
      }),
      "class_subjects_class_subject_uq",
    );

    await expectConstraintViolation(
      db.insert(classSubjects).values({
        schoolId: schoolA.id,
        classId: classA1.id,
        subjectId: subjectB.id,
      }),
      "class_subjects_subject_school_fk",
    );

    // Control: another subject on the same class.
    await db.insert(classSubjects).values({
      schoolId: schoolA.id,
      classId: classA2.id,
      subjectId: subjectA1.id,
    });
  });

  it("class subjects: an elective group from another class is refused", async () => {
    await expectConstraintViolation(
      db.insert(classSubjects).values({
        schoolId: schoolA.id,
        classId: classA2.id,
        subjectId: subjectA1.id,
        electiveGroupId: groupA.id,
      }),
      "class_subjects_elective_group_class_fk",
    );
  });

  it("enrollments: class/session and student/school must agree", async () => {
    await expectConstraintViolation(
      db.insert(classEnrollments).values({
        schoolId: schoolA.id,
        studentId: profileA.id,
        classId: classA2.id,
        sessionId: sessionB.id,
        startedAt: new Date(),
      }),
      "class_enrollments_class_session_fk",
    );

    await expectConstraintViolation(
      db.insert(classEnrollments).values({
        schoolId: schoolA.id,
        studentId: profileB.id,
        classId: classA1.id,
        sessionId: sessionA.id,
        startedAt: new Date(),
      }),
      "class_enrollments_student_school_fk",
    );
  });

  it("enrollments: one active per student/session, history and transfers are allowed", async () => {
    await expectConstraintViolation(
      db.insert(classEnrollments).values({
        schoolId: schoolA.id,
        studentId: profileA.id,
        classId: classA2.id,
        sessionId: sessionA.id,
        startedAt: new Date("2026-10-01T00:00:00Z"),
      }),
      "class_enrollments_one_active_session_uq",
    );

    await db
      .update(classEnrollments)
      .set({ status: "transferred", endedAt: new Date("2026-10-01T00:00:00Z"), endedReason: "transfer" })
      .where(eq(classEnrollments.id, enrollmentA1.id));

    const next = one(
      await db
        .insert(classEnrollments)
        .values({
          schoolId: schoolA.id,
          studentId: profileA.id,
          classId: classA2.id,
          sessionId: sessionA.id,
          startedAt: new Date("2026-10-01T00:00:00Z"),
          transferredFromEnrollmentId: enrollmentA1.id,
        })
        .returning(),
    );
    expect(next.transferredFromEnrollmentId).toBe(enrollmentA1.id);

    // Control: an old row may remain ended alongside the active row.
    const rows = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.studentId, profileA.id));
    expect(rows).toHaveLength(2);
  });

  it("enrollments: the transfer source must belong to the same school", async () => {
    const enrollmentB = one(
      await db
        .insert(classEnrollments)
        .values({
          schoolId: schoolB.id,
          studentId: profileB.id,
          classId: classB.id,
          sessionId: sessionB.id,
          startedAt: new Date(),
        })
        .returning(),
    );

    await db
      .update(classEnrollments)
      .set({ status: "withdrawn", endedAt: new Date(), endedReason: "withdrawn" })
      .where(eq(classEnrollments.id, enrollmentA1.id));

    await expectConstraintViolation(
      db.insert(classEnrollments).values({
        schoolId: schoolA.id,
        studentId: profileA.id,
        classId: classA1.id,
        sessionId: sessionA.id,
        startedAt: new Date(),
        transferredFromEnrollmentId: enrollmentB.id,
      }),
      "class_enrollments_transferred_from_fk",
    );
  });

  it("student subjects: normal path, duplicates, and class/session agreement", async () => {
    const valid = one(
      await db
        .insert(studentSubjects)
        .values({
          schoolId: schoolA.id,
          enrollmentId: enrollmentA1.id,
          classId: classA1.id,
          sessionId: sessionA.id,
          classSubjectId: csA1.id,
        })
        .returning(),
    );
    expect(valid.isExtra).toBe(false);

    await expectConstraintViolation(
      db.insert(studentSubjects).values({
        schoolId: schoolA.id,
        enrollmentId: enrollmentA1.id,
        classId: classA1.id,
        sessionId: sessionA.id,
        classSubjectId: csA1.id,
      }),
      "student_subjects_enrollment_offering_uq",
    );

    await expectConstraintViolation(
      db.insert(studentSubjects).values({
        schoolId: schoolA.id,
        enrollmentId: enrollmentA1.id,
        classId: classA2.id,
        sessionId: sessionA.id,
        classSubjectId: csA2.id,
      }),
      "student_subjects_enrollment_class_fk",
    );

    await expectConstraintViolation(
      db.insert(studentSubjects).values({
        schoolId: schoolA.id,
        enrollmentId: enrollmentA1.id,
        classId: classA1.id,
        sessionId: sessionB.id,
        classSubjectId: csA2.id,
      }),
      "student_subjects_class_session_fk",
    );
  });

  it("student subjects: the offering and extra subject are mutually exclusive", async () => {
    await expectConstraintViolation(
      db.insert(studentSubjects).values({
        schoolId: schoolA.id,
        enrollmentId: enrollmentA1.id,
        classId: classA1.id,
        sessionId: sessionA.id,
        classSubjectId: null,
        subjectId: null,
      }),
      "student_subjects_one_choice_chk",
    );

    await expectConstraintViolation(
      db.insert(studentSubjects).values({
        schoolId: schoolA.id,
        enrollmentId: enrollmentA1.id,
        classId: classA1.id,
        sessionId: sessionA.id,
        classSubjectId: csA1.id,
        subjectId: subjectA2.id,
      }),
      "student_subjects_one_choice_chk",
    );

    const extra = one(
      await db
        .insert(studentSubjects)
        .values({
          schoolId: schoolA.id,
          enrollmentId: enrollmentA1.id,
          classId: classA1.id,
          sessionId: sessionA.id,
          classSubjectId: null,
          subjectId: subjectA2.id,
        })
        .returning(),
    );
    expect(extra.isExtra).toBe(true);
  });

  it("student subjects: an offering from another class is refused", async () => {
    const otherOffering = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: schoolA.id,
          classId: classA2.id,
          subjectId: subjectA1.id,
        })
        .returning(),
    );

    await expectConstraintViolation(
      db.insert(studentSubjects).values({
        schoolId: schoolA.id,
        enrollmentId: enrollmentA1.id,
        classId: classA1.id,
        sessionId: sessionA.id,
        classSubjectId: otherOffering.id,
      }),
      "student_subjects_offering_class_fk",
    );
  });

  it("student subjects: an offering from another school is refused", async () => {
    await expectConstraintViolation(
      db.insert(studentSubjects).values({
        schoolId: schoolA.id,
        enrollmentId: enrollmentA1.id,
        classId: classA1.id,
        sessionId: sessionA.id,
        classSubjectId: csB.id,
      }),
      "student_subjects_offering_class_fk",
    );
  });

  it("class subjects: a compulsory offering cannot be in an elective group", async () => {
    const group = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: schoolA.id,
          classId: classA2.id,
          sessionId: sessionA.id,
          name: "Senior electives",
          minChoices: 1,
          maxChoices: 2,
        })
        .returning(),
    );

    await expectConstraintViolation(
      db.insert(classSubjects).values({
        schoolId: schoolA.id,
        classId: classA2.id,
        subjectId: subjectA1.id,
        electiveGroupId: group.id,
        isCompulsory: true,
      }),
      "class_subjects_compulsory_not_elective_chk",
    );

    // Control: the same offering is valid when it is not compulsory.
    await db.insert(classSubjects).values({
      schoolId: schoolA.id,
      classId: classA2.id,
      subjectId: subjectA1.id,
      electiveGroupId: group.id,
      isCompulsory: false,
    });
  });
});
