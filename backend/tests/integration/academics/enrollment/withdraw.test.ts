import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  schools,
  users,
  memberships,
  membershipRoles,
  roles,
  academicSessions,
  levels,
  classes,
  subjects,
  classSubjects,
  electiveGroups,
  studentProfiles,
  classEnrollments,
  studentSubjects,
  auditLog,
  type School,
  type AcademicSession,
  type Class,
  type Level,
  type StudentProfile,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { withdrawEnrollment } from "../../../../src/modules/academics/enrollment/withdraw.js";
import { enrollStudent } from "../../../../src/modules/academics/enrollment/service.js";
import { setElectives } from "../../../../src/modules/academics/enrollment/electives.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

let school: School;
let actor: Actor;
let level: Level;
let sessionOpen: AcademicSession;
let sessionClosed: AcademicSession;
let cls: Class;
let clsClosed: Class;
let student: StudentProfile;
let enrollmentId: string;

async function makeSubject(schoolId: string) {
  return one(
    await db
      .insert(subjects)
      .values({
        schoolId,
        code: `SUB-${crypto.randomUUID().slice(0, 8)}`,
        name: `Subject ${crypto.randomUUID().slice(0, 4)}`,
      })
      .returning(),
  );
}

async function makeStudent(opts: { schoolId: string }) {
  const user = one(
    await db
      .insert(users)
      .values({
        email: `stu-${crypto.randomUUID().slice(0, 8)}@test`,
        firstName: "Stu",
        lastName: "Dent",
      })
      .returning(),
  );
  const membership = one(
    await db
      .insert(memberships)
      .values({
        userId: user.id,
        schoolId: opts.schoolId,
        status: "active",
      })
      .returning(),
  );
  const role = one(
    await db
      .insert(roles)
      .values({
        schoolId: opts.schoolId,
        key: `student-${crypto.randomUUID().slice(0, 6)}`,
        name: "Student",
        kind: "student",
        rank: 10,
        isSystem: false,
      })
      .returning(),
  );
  await db.insert(membershipRoles).values({
    membershipId: membership.id,
    roleId: role.id,
    schoolId: opts.schoolId,
  });
  return one(
    await db
      .insert(studentProfiles)
      .values({
        schoolId: opts.schoolId,
        membershipId: membership.id,
        admissionNumber: `ADM-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning(),
  );
}

describe("withdrawEnrollment — integration", () => {
  beforeEach(async () => {
    school = one(
      await db
        .insert(schools)
        .values({ name: "S", slug: `s-${crypto.randomUUID()}` })
        .returning(),
    );
    const user = one(
      await db
        .insert(users)
        .values({
          email: `t-${crypto.randomUUID()}@test`,
          firstName: "T",
          lastName: "T",
        })
        .returning(),
    );
    const membership = one(
      await db
        .insert(memberships)
        .values({ userId: user.id, schoolId: school.id })
        .returning(),
    );
    actor = {
      userId: user.id,
      membershipId: membership.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(["enrollments:manage"]),
    };

    level = one(
      await db
        .insert(levels)
        .values({
          schoolId: school.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );

    sessionOpen = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2025/2026" })
        .returning(),
    );
    sessionClosed = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId: school.id,
          label: "2024/2025",
          closedAt: new Date(),
        })
        .returning(),
    );

    cls = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: sessionOpen.id,
          levelId: level.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );
    clsClosed = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: sessionClosed.id,
          levelId: level.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );

    student = await makeStudent({ schoolId: school.id });
    const enrolled = await db.transaction((tx) =>
      enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
    );
    enrollmentId = enrolled.enrollmentId;
  });

  // ══════════════════════════════════════════════════════════════════════
  // Happy path
  // ══════════════════════════════════════════════════════════════════════
  it("withdraws: status='withdrawn', ended_at set, ended_reason", async () => {
    const result = await db.transaction((tx) =>
      withdrawEnrollment(tx, actor, {
        enrollmentId,
        reason: "family relocated",
      }),
    );

    expect(result.enrollment.status).toBe("withdrawn");
    expect(result.enrollment.endedAt).not.toBeNull();
    expect(result.enrollment.endedReason).toBe("family relocated");

    const row = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.id, enrollmentId));
    expect(row[0]!.status).toBe("withdrawn");
    expect(row[0]!.endedAt).not.toBeNull();
  });

  it("uses default reason when omitted", async () => {
    const result = await db.transaction((tx) =>
      withdrawEnrollment(tx, actor, { enrollmentId }),
    );
    expect(result.enrollment.endedReason).toBe("withdrawn");
  });

  it("preserves all student_subjects rows", async () => {
    // Add an elective so there's something to preserve.
    const grp = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: school.id,
          classId: cls.id,
          sessionId: sessionOpen.id,
          name: "G",
          minChoices: 1,
          maxChoices: 1,
        })
        .returning(),
    );
    const subj = await makeSubject(school.id);
    const elective = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: school.id,
          classId: cls.id,
          subjectId: subj.id,
          isCompulsory: false,
          electiveGroupId: grp.id,
        })
        .returning(),
    );
    await db.transaction((tx) =>
      setElectives(tx, actor, { enrollmentId, offeringIds: [elective.id] }),
    );

    const before = await db
      .select()
      .from(studentSubjects)
      .where(eq(studentSubjects.enrollmentId, enrollmentId));
    expect(before.length).toBeGreaterThan(0);

    await db.transaction((tx) =>
      withdrawEnrollment(tx, actor, { enrollmentId }),
    );

    const after = await db
      .select()
      .from(studentSubjects)
      .where(eq(studentSubjects.enrollmentId, enrollmentId));
    expect(after.length).toBe(before.length);
    // Same row IDs, same droppedAt.
    expect(after.map((r) => r.id).sort()).toEqual(
      before.map((r) => r.id).sort(),
    );
    expect(after.every((r) => r.droppedAt === null)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════
  // Guards
  // ══════════════════════════════════════════════════════════════════════
  it("409 ENROLLMENT_NOT_ACTIVE on second withdraw", async () => {
    await db.transaction((tx) =>
      withdrawEnrollment(tx, actor, { enrollmentId }),
    );

    await expect(
      db.transaction((tx) =>
        withdrawEnrollment(tx, actor, { enrollmentId }),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "ENROLLMENT_NOT_ACTIVE",
    });
  });

  it("409 SESSION_LOCKED when the session is closed", async () => {
    // Enroll a student in the closed class directly (bypassing enrollStudent,
    // which would refuse due to the closed session).
    await db.insert(classEnrollments).values({
      schoolId: school.id,
      studentId: student.id,
      classId: clsClosed.id,
      sessionId: sessionClosed.id,
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365), // a year ago
      status: "active",
      endedAt: null,
      endedReason: null,
      transferredFromEnrollmentId: null,
    });
    const closedEnrollment = one(
      await db
        .select()
        .from(classEnrollments)
        .where(
          and(
            eq(classEnrollments.studentId, student.id),
            eq(classEnrollments.classId, clsClosed.id),
          ),
        ),
    );

    await expect(
      db.transaction((tx) =>
        withdrawEnrollment(tx, actor, { enrollmentId: closedEnrollment.id }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("404 ENROLLMENT_NOT_FOUND when the enrollment is in another school", async () => {
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "O", slug: `o-${crypto.randomUUID()}` })
        .returning(),
    );
    const otherLevel = one(
      await db
        .insert(levels)
        .values({
          schoolId: otherSchool.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: otherSchool.id, label: "2025/2026" })
        .returning(),
    );
    const otherCls = one(
      await db
        .insert(classes)
        .values({
          schoolId: otherSchool.id,
          sessionId: otherSession.id,
          levelId: otherLevel.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );
    const otherStudent = await makeStudent({ schoolId: otherSchool.id });
    const foreignEnrollment = one(
      await db
        .insert(classEnrollments)
        .values({
          schoolId: otherSchool.id,
          studentId: otherStudent.id,
          classId: otherCls.id,
          sessionId: otherSession.id,
          startedAt: new Date(),
          status: "active",
          endedAt: null,
          endedReason: null,
          transferredFromEnrollmentId: null,
        })
        .returning(),
    );

    await expect(
      db.transaction((tx) =>
        withdrawEnrollment(tx, actor, { enrollmentId: foreignEnrollment.id }),
      ),
    ).rejects.toMatchObject({
      httpStatus: 404,
      code: "ENROLLMENT_NOT_FOUND",
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Audit
  // ══════════════════════════════════════════════════════════════════════
  it("writes one enrollment.withdrawn audit row", async () => {
    await db.transaction((tx) =>
      withdrawEnrollment(tx, actor, {
        enrollmentId,
        reason: "family relocated",
      }),
    );

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.targetId, enrollmentId),
          eq(auditLog.action, "enrollment.withdrawn"),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.targetType).toBe("class_enrollment");
  });
});