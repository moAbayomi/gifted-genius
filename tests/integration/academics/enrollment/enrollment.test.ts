import { describe, it, expect, beforeEach } from "vitest";
import { count, eq } from "drizzle-orm";
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
  type Subject,
  type StudentProfile,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  enrollStudent,
  bulkEnroll,
} from "../../../../src/modules/academics/enrollment/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

// ── Fixtures & helpers ────────────────────────────────────────────────
let school: School;
let actor: Actor;
let level: Level;
let session: AcademicSession;
let cls: Class;

async function makeSubject(schoolId: string): Promise<Subject> {
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

async function addCompulsoryOffering(
  schoolId: string,
  classId: string,
): Promise<void> {
  const subj = await makeSubject(schoolId);
  await db.insert(classSubjects).values({
    schoolId,
    classId,
    subjectId: subj.id,
    isCompulsory: true,
    electiveGroupId: null,
  });
}

async function addElectiveOffering(
  schoolId: string,
  classId: string,
  sessionId: string,
  levelId: string,
): Promise<void> {
  // Elective offerings need a group.
  const grp = one(
    await db
      .insert(electiveGroups)
      .values({
        schoolId,
        classId,
        sessionId,
        name: `G-${crypto.randomUUID().slice(0, 4)}`,
        minChoices: 1,
        maxChoices: 2,
      })
      .returning(),
  );
  const subj = await makeSubject(schoolId);
  await db.insert(classSubjects).values({
    schoolId,
    classId,
    subjectId: subj.id,
    isCompulsory: false,
    electiveGroupId: grp.id,
  });
  void levelId; // levelId kept for potential future use; not required here
}

interface MakeStudentOptions {
  schoolId: string;
  status?: "active" | "inactive" | "suspended";
  roleKind?: "student" | "staff" | "guardian";
}

async function makeStudent(opts: MakeStudentOptions): Promise<{
  student: StudentProfile;
  membershipId: string;
}> {
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
        status: opts.status ?? "active",
      })
      .returning(),
  );
  const role = one(
    await db
      .insert(roles)
      .values({
        schoolId: opts.schoolId,
        key: `role-${crypto.randomUUID().slice(0, 8)}`,
        name: `Role ${crypto.randomUUID().slice(0, 4)}`,
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
  const student = one(
    await db
      .insert(studentProfiles)
      .values({
        schoolId: opts.schoolId,
        membershipId: membership.id,
        admissionNumber: `ADM-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning(),
  );
  return { student, membershipId: membership.id };
}

async function countEnrollments(): Promise<number> {
  const r = one(await db.select({ n: count() }).from(classEnrollments));
  return r.n;
}
async function countStudentSubjects(): Promise<number> {
  const r = one(await db.select({ n: count() }).from(studentSubjects));
  return r.n;
}
async function countAuditRows(): Promise<number> {
  const r = one(await db.select({ n: count() }).from(auditLog));
  return r.n;
}

// ── Suite ─────────────────────────────────────────────────────────────

describe("enrollment — integration", () => {
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
    session = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2025/2026" })
        .returning(),
    );
    cls = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: session.id,
          levelId: level.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // enrollStudent — happy paths
  // ══════════════════════════════════════════════════════════════════════
  describe("enrollStudent — happy paths", () => {
    it("enrolls one student → one active enrollment", async () => {
      const { student } = await makeStudent({ schoolId: school.id });

      const result = await db.transaction((tx) =>
        enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
      );

      expect(result.studentId).toBe(student.id);
      expect(result.classId).toBe(cls.id);
      expect(result.enrollmentId).toBeTruthy();
      expect(result.compulsorySubjects).toBe(0);

      const rows = await db
        .select()
        .from(classEnrollments)
        .where(eq(classEnrollments.id, result.enrollmentId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.endedAt).toBeNull();
      expect(rows[0]!.sessionId).toBe(session.id);
    });

    it("two compulsory offerings → exactly two student_subjects rows", async () => {
      await addCompulsoryOffering(school.id, cls.id);
      await addCompulsoryOffering(school.id, cls.id);
      const { student } = await makeStudent({ schoolId: school.id });

      const result = await db.transaction((tx) =>
        enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
      );
      expect(result.compulsorySubjects).toBe(2);

      const rows = await db
        .select()
        .from(studentSubjects)
        .where(eq(studentSubjects.enrollmentId, result.enrollmentId));
      expect(rows).toHaveLength(2);
    });

    it("only elective offerings → enrollment created, zero student_subjects", async () => {
      await addElectiveOffering(school.id, cls.id, session.id, level.id);
      const { student } = await makeStudent({ schoolId: school.id });

      const result = await db.transaction((tx) =>
        enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
      );
      expect(result.compulsorySubjects).toBe(0);

      const rows = await db
        .select()
        .from(studentSubjects)
        .where(eq(studentSubjects.enrollmentId, result.enrollmentId));
      expect(rows).toHaveLength(0);
    });

    it("no offerings → enrollment created, zero subjects", async () => {
      const { student } = await makeStudent({ schoolId: school.id });

      const result = await db.transaction((tx) =>
        enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
      );
      expect(result.compulsorySubjects).toBe(0);
      expect(await countStudentSubjects()).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // enrollStudent — active enrollment rules
  // ══════════════════════════════════════════════════════════════════════
  describe("enrollStudent — existing enrollments", () => {
    it("409 ALREADY_ENROLLED when already active in this session", async () => {
      const { student } = await makeStudent({ schoolId: school.id });

      await db.transaction((tx) =>
        enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
      );

      await expect(
        db.transaction((tx) =>
          enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
        ),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "ALREADY_ENROLLED",
      });
    });

    it("new active enrollment succeeds after an ended enrollment in the same session", async () => {
      const { student } = await makeStudent({ schoolId: school.id });

      // End the first enrollment directly — simulating a transfer out.
      const first = await db.transaction((tx) =>
        enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
      );
      await db
        .update(classEnrollments)
        .set({ status: "transferred", endedAt: new Date(), endedReason: "transferred" })
        .where(eq(classEnrollments.id, first.enrollmentId));

      // Now re-enroll — the partial unique ignores ended rows.
      const second = await db.transaction((tx) =>
        enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
      );
      expect(second.enrollmentId).not.toBe(first.enrollmentId);

      const active = await db
        .select()
        .from(classEnrollments)
        .where(eq(classEnrollments.studentId, student.id));
      const live = active.filter((r) => r.endedAt === null);
      expect(live).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // enrollStudent — guards
  // ══════════════════════════════════════════════════════════════════════
  describe("enrollStudent — guards", () => {
    it("409 CLASS_ARCHIVED when the class is archived", async () => {
      const archivedCls = one(
        await db
          .insert(classes)
          .values({
            schoolId: school.id,
            sessionId: session.id,
            levelId: level.id,
            armLabel: "Z",
            track: "general",
            archivedAt: new Date(),
          })
          .returning(),
      );
      const { student } = await makeStudent({ schoolId: school.id });

      await expect(
        db.transaction((tx) =>
          enrollStudent(tx, actor, {
            studentId: student.id,
            classId: archivedCls.id,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ARCHIVED" });
    });

    it("409 SESSION_LOCKED when the session is closed", async () => {
      const closedSession = one(
        await db
          .insert(academicSessions)
          .values({
            schoolId: school.id,
            label: "2024/2025",
            closedAt: new Date(),
          })
          .returning(),
      );
      const closedCls = one(
        await db
          .insert(classes)
          .values({
            schoolId: school.id,
            sessionId: closedSession.id,
            levelId: level.id,
            armLabel: "C",
            track: "general",
          })
          .returning(),
      );
      const { student } = await makeStudent({ schoolId: school.id });

      await expect(
        db.transaction((tx) =>
          enrollStudent(tx, actor, {
            studentId: student.id,
            classId: closedCls.id,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
    });

    it("404 when the student's membership is suspended", async () => {
      const { student } = await makeStudent({
        schoolId: school.id,
        status: "suspended",
      });

      await expect(
        db.transaction((tx) =>
          enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404, code: "STUDENT_NOT_FOUND" });
    });

    it("404 when the student's role kind is not 'student'", async () => {
      const { student } = await makeStudent({
        schoolId: school.id,
        roleKind: "staff",
      });

      await expect(
        db.transaction((tx) =>
          enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404, code: "STUDENT_NOT_FOUND" });
    });

    it("404 for a student from another school", async () => {
      const otherSchool = one(
        await db
          .insert(schools)
          .values({ name: "O", slug: `o-${crypto.randomUUID()}` })
          .returning(),
      );
      const { student } = await makeStudent({ schoolId: otherSchool.id });

      await expect(
        db.transaction((tx) =>
          enrollStudent(tx, actor, { studentId: student.id, classId: cls.id }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404, code: "STUDENT_NOT_FOUND" });
    });

    it("404 for a class from another school", async () => {
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
      const { student } = await makeStudent({ schoolId: school.id });

      await expect(
        db.transaction((tx) =>
          enrollStudent(tx, actor, {
            studentId: student.id,
            classId: otherCls.id,
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // bulkEnroll
  // ══════════════════════════════════════════════════════════════════════
  describe("bulkEnroll", () => {
    it("enrolls three students → three enrollments, correct subject counts", async () => {
      await addCompulsoryOffering(school.id, cls.id);
      await addCompulsoryOffering(school.id, cls.id);

      const s1 = await makeStudent({ schoolId: school.id });
      const s2 = await makeStudent({ schoolId: school.id });
      const s3 = await makeStudent({ schoolId: school.id });

      const results = await bulkEnroll(actor, {
        classId: cls.id,
        studentIds: [s1.student.id, s2.student.id, s3.student.id],
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.compulsorySubjects === 2)).toBe(true);
      expect(await countEnrollments()).toBe(3);
      expect(await countStudentSubjects()).toBe(6); // 3 students × 2 subjects
    });

    it("one invalid student rolls back the entire batch", async () => {
      const good1 = await makeStudent({ schoolId: school.id });
      const good2 = await makeStudent({ schoolId: school.id });
      const bad = await makeStudent({
        schoolId: school.id,
        status: "suspended",
      });

      const before = await countEnrollments();

      await expect(
        bulkEnroll(actor, {
          classId: cls.id,
          studentIds: [good1.student.id, good2.student.id, bad.student.id],
        }),
      ).rejects.toMatchObject({ httpStatus: 404, code: "STUDENT_NOT_FOUND" });

      // Whole batch rolled back — good1 and good2 got nothing.
      expect(await countEnrollments()).toBe(before);
    });

    it("400 DUPLICATE_STUDENT when studentIds contains duplicates", async () => {
      const s = await makeStudent({ schoolId: school.id });

      await expect(
        bulkEnroll(actor, {
          classId: cls.id,
          studentIds: [s.student.id, s.student.id],
        }),
      ).rejects.toMatchObject({ httpStatus: 400, code: "DUPLICATE_STUDENT" });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Dry run
  // ══════════════════════════════════════════════════════════════════════
  describe("bulkEnroll — dry run", () => {
    it("dry run previews without persisting; real run then commits", async () => {
      await addCompulsoryOffering(school.id, cls.id);

      const s1 = await makeStudent({ schoolId: school.id });
      const s2 = await makeStudent({ schoolId: school.id });
      const ids = [s1.student.id, s2.student.id];

      const beforeEnrollments = await countEnrollments();
      const beforeSS = await countStudentSubjects();
      const beforeAudits = await countAuditRows();

      // ── Dry run ──
      const preview = await bulkEnroll(actor, {
        classId: cls.id,
        studentIds: ids,
        dryRun: true,
      });

      expect(preview).toHaveLength(2);
      expect(preview.every((r) => r.enrollmentId.length > 0)).toBe(true);
      expect(preview.every((r) => r.compulsorySubjects === 1)).toBe(true);

      // Nothing persisted.
      expect(await countEnrollments()).toBe(beforeEnrollments);
      expect(await countStudentSubjects()).toBe(beforeSS);
      expect(await countAuditRows()).toBe(beforeAudits);

      // ── Real run for the same input ──
      const real = await bulkEnroll(actor, {
        classId: cls.id,
        studentIds: ids,
        dryRun: false,
      });

      expect(real).toHaveLength(2);
      expect(real.every((r) => r.compulsorySubjects === 1)).toBe(true);

      // Now counts increased.
      expect(await countEnrollments()).toBe(beforeEnrollments + 2);
      expect(await countStudentSubjects()).toBe(beforeSS + 2);
      expect(await countAuditRows()).toBeGreaterThan(beforeAudits);
    });
  });
});
