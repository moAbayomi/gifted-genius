import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
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
  type School,
  type AcademicSession,
  type Class,
  type Level,
  type StudentProfile,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { transferStudent } from "../../../../src/modules/academics/enrollment/transfer.js";
import { enrollStudent } from "../../../../src/modules/academics/enrollment/service.js";
import { setElectives } from "../../../../src/modules/academics/enrollment/electives.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

// ── Shared fixtures ───────────────────────────────────────────────────
let school: School;
let actor: Actor;
let level: Level;
let sessionA: AcademicSession;      // open — student starts here
let sessionB: AcademicSession;      // open — target session
let sessionClosed: AcademicSession; // closed — for 409 SESSION_LOCKED
let classA: Class;                  // student's current class
let classA2: Class;                 // another class in session A (same-session target)
let classB: Class;                  // target in session B
let classClosed: Class;             // target in a closed session
let classArchived: Class;           // archived target in session B
let student: StudentProfile;
let enrollmentId: string;

async function makeSubject(schoolId: string, code?: string) {
  return one(
    await db
      .insert(subjects)
      .values({
        schoolId,
        code: code ?? `SUB-${crypto.randomUUID().slice(0, 8)}`,
        name: `Subject ${crypto.randomUUID().slice(0, 4)}`,
      })
      .returning(),
  );
}

async function makeStudent(opts: { schoolId: string; roleKind?: "student" | "staff" | "guardian" }) {
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
        kind: opts.roleKind ?? "student",
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
  const profile = one(
    await db
      .insert(studentProfiles)
      .values({
        schoolId: opts.schoolId,
        membershipId: membership.id,
        admissionNumber: `ADM-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning(),
  );
  return profile;
}

async function countStudentSubjectsForEnrollment(id: string) {
  const rows = await db
    .select()
    .from(studentSubjects)
    .where(eq(studentSubjects.enrollmentId, id));
  return rows.length;
}

// ── Suite ─────────────────────────────────────────────────────────────

describe("transferStudent — integration", () => {
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

    sessionA = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2025/2026" })
        .returning(),
    );
    sessionB = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2026/2027" })
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

    classA = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: sessionA.id,
          levelId: level.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );
    classA2 = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: sessionA.id,
          levelId: level.id,
          armLabel: "B",
          track: "general",
        })
        .returning(),
    );
    classB = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: sessionB.id,
          levelId: level.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );
    classClosed = one(
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
    classArchived = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: sessionB.id,
          levelId: level.id,
          armLabel: "Z",
          track: "general",
          archivedAt: new Date(),
        })
        .returning(),
    );

    student = await makeStudent({ schoolId: school.id });

    // Enroll student in classA via the real service.
    const enrolled = await db.transaction((tx) =>
      enrollStudent(tx, actor, { studentId: student.id, classId: classA.id }),
    );
    enrollmentId = enrolled.enrollmentId;
  });

  // ══════════════════════════════════════════════════════════════════════
  // Happy path
  // ══════════════════════════════════════════════════════════════════════
  it("same-session transfer → exactly one active enrollment remains", async () => {
    const result = await db.transaction((tx) =>
      transferStudent(tx, actor, {
        enrollmentId,
        targetClassId: classA2.id,
      }),
    );

    expect(result.oldEnrollment.id).toBe(enrollmentId);
    expect(result.newEnrollment.classId).toBe(classA2.id);
    expect(result.newEnrollment.sessionId).toBe(sessionA.id);

    // Exactly one active enrollment in session A.
    const active = await db
      .select()
      .from(classEnrollments)
      .where(
        and(
          eq(classEnrollments.studentId, student.id),
          eq(classEnrollments.sessionId, sessionA.id),
          isNull(classEnrollments.endedAt),
        ),
      );
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(result.newEnrollment.id);
  });

  it("old row has status='transferred', ended_at set, ended_reason", async () => {
    const result = await db.transaction((tx) =>
      transferStudent(tx, actor, {
        enrollmentId,
        targetClassId: classB.id,
      }),
    );

    expect(result.oldEnrollment.status).toBe("transferred");
    expect(result.oldEnrollment.endedAt).not.toBeNull();
    expect(result.oldEnrollment.endedReason).toBe("transferred");
  });

  it("new row is in target class and links back via transferred_from_enrollment_id", async () => {
    const result = await db.transaction((tx) =>
      transferStudent(tx, actor, {
        enrollmentId,
        targetClassId: classB.id,
      }),
    );

    expect(result.newEnrollment.classId).toBe(classB.id);
    expect(result.newEnrollment.sessionId).toBe(sessionB.id);
    expect(result.newEnrollment.status).toBe("active");
    expect(result.newEnrollment.endedAt).toBeNull();
    expect(result.newEnrollment.transferredFromEnrollmentId).toBe(
      enrollmentId,
    );
  });

  it("old enrollment's student_subjects rows are preserved", async () => {
    // Give the student an elective choice in classA first.
    const grp = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: school.id,
          classId: classA.id,
          sessionId: sessionA.id,
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
          classId: classA.id,
          subjectId: subj.id,
          isCompulsory: false,
          electiveGroupId: grp.id,
        })
        .returning(),
    );
    await db.transaction((tx) =>
      setElectives(tx, actor, { enrollmentId, offeringIds: [elective.id] }),
    );

    const before = await countStudentSubjectsForEnrollment(enrollmentId);
    expect(before).toBeGreaterThan(0);

    await db.transaction((tx) =>
      transferStudent(tx, actor, {
        enrollmentId,
        targetClassId: classB.id,
      }),
    );

    const after = await countStudentSubjectsForEnrollment(enrollmentId);
    expect(after).toBe(before);
  });

  it("target class's compulsory subjects are created for the new enrollment", async () => {
    const subj = await makeSubject(school.id, "MATH");
    await db.insert(classSubjects).values({
      schoolId: school.id,
      classId: classB.id,
      subjectId: subj.id,
      isCompulsory: true,
      electiveGroupId: null,
    });

    const result = await db.transaction((tx) =>
      transferStudent(tx, actor, {
        enrollmentId,
        targetClassId: classB.id,
      }),
    );

    expect(result.compulsorySubjects).toBe(1);

    const rows = await db
      .select()
      .from(studentSubjects)
      .where(eq(studentSubjects.enrollmentId, result.newEnrollment.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.droppedAt).toBeNull();
  });

  it("target electives are empty — electives do not transfer", async () => {
    // Give the old enrollment an elective.
    const grpA = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: school.id,
          classId: classA.id,
          sessionId: sessionA.id,
          name: "GA",
          minChoices: 1,
          maxChoices: 1,
        })
        .returning(),
    );
    const subjA = await makeSubject(school.id);
    const electiveA = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: school.id,
          classId: classA.id,
          subjectId: subjA.id,
          isCompulsory: false,
          electiveGroupId: grpA.id,
        })
        .returning(),
    );
    await db.transaction((tx) =>
      setElectives(tx, actor, {
        enrollmentId,
        offeringIds: [electiveA.id],
      }),
    );

    // Give the target an elective offering the student COULD pick.
    const grpB = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: school.id,
          classId: classB.id,
          sessionId: sessionB.id,
          name: "GB",
          minChoices: 1,
          maxChoices: 1,
        })
        .returning(),
    );
    const subjB = await makeSubject(school.id);
    await db.insert(classSubjects).values({
      schoolId: school.id,
      classId: classB.id,
      subjectId: subjB.id,
      isCompulsory: false,
      electiveGroupId: grpB.id,
    });

    const result = await db.transaction((tx) =>
      transferStudent(tx, actor, {
        enrollmentId,
        targetClassId: classB.id,
      }),
    );

    // New enrollment has zero student_subjects — electives were NOT copied.
    const rows = await db
      .select()
      .from(studentSubjects)
      .where(eq(studentSubjects.enrollmentId, result.newEnrollment.id));
    expect(rows).toHaveLength(0);
  });

  // ══════════════════════════════════════════════════════════════════════
  // Guards
  // ══════════════════════════════════════════════════════════════════════
  it("409 CLASS_ARCHIVED when the target class is archived", async () => {
    await expect(
      db.transaction((tx) =>
        transferStudent(tx, actor, {
          enrollmentId,
          targetClassId: classArchived.id,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ARCHIVED" });

    // Old enrollment stays active.
    const old = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.id, enrollmentId));
    expect(old[0]!.status).toBe("active");
    expect(old[0]!.endedAt).toBeNull();
  });

  it("409 SESSION_LOCKED when the target session is closed", async () => {
    await expect(
      db.transaction((tx) =>
        transferStudent(tx, actor, {
          enrollmentId,
          targetClassId: classClosed.id,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("404 CLASS_NOT_FOUND when the target class is in another school", async () => {
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

    await expect(
      db.transaction((tx) =>
        transferStudent(tx, actor, {
          enrollmentId,
          targetClassId: otherCls.id,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
  });

  it("409 ENROLLMENT_NOT_ACTIVE when the old enrollment is already ended", async () => {
    // Transfer once.
    await db.transaction((tx) =>
      transferStudent(tx, actor, {
        enrollmentId,
        targetClassId: classB.id,
      }),
    );

    // Try to transfer the SAME old row again.
    await expect(
      db.transaction((tx) =>
        transferStudent(tx, actor, {
          enrollmentId,
          targetClassId: classA2.id,
        }),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "ENROLLMENT_NOT_ACTIVE",
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Rollback
  // ══════════════════════════════════════════════════════════════════════
  it("rolls back the old enrollment's status if the new insert fails", async () => {
    // Precondition: student already has an active enrollment in session B.
    // We'll create one directly (bypassing enrollStudent's session check
    // is fine — we need a state, not a workflow).
    await db.insert(classEnrollments).values({
      schoolId: school.id,
      studentId: student.id,
      classId: classB.id,
      sessionId: sessionB.id,
      startedAt: new Date(),
      status: "active",
      endedAt: null,
      endedReason: null,
      transferredFromEnrollmentId: null,
    });

    // Now try to transfer the sessionA enrollment into sessionB's class.
    // The old (sessionA) row ends first, then the INSERT into sessionB
    // fails because the student is already active there.
    await expect(
      db.transaction((tx) =>
        transferStudent(tx, actor, {
          enrollmentId,
          targetClassId: classB.id,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "ALREADY_ENROLLED" });

    // Rollback: old sessionA enrollment is STILL active.
    const old = await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.id, enrollmentId));
    expect(old[0]!.status).toBe("active");
    expect(old[0]!.endedAt).toBeNull();
  });
});