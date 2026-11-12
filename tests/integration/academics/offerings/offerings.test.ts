// tests/integration/academics/offerings/offerings.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  schools,
  users,
  memberships,
  academicSessions,
  levels,
  classes,
  subjects,
  electiveGroups,
  classSubjects,
  studentProfiles,
  classEnrollments,
  studentSubjects,
  auditLog,
  type School,
  type AcademicSession,
  type Class,
  type Level,
  type Subject,
  type ElectiveGroup,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  addOfferings,
  withdrawOffering,
} from "../../../../src/modules/academics/offerings/service.js";
import { archiveClass } from "../../../../src/modules/academics/classes/service.js";
import { archiveSubject } from "../../../../src/modules/academics/subjects/service.js";
import { archiveElectiveGroup } from "../../../../src/modules/academics/elective-groups/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

// ── Shared fixtures ───────────────────────────────────────────────────
let school: School;
let actor: Actor;
let level: Level;
let session: AcademicSession;
let cls: Class;
let group: ElectiveGroup;

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

interface EnrolledStudent {
  studentId: string;
  enrollmentId: string;
}

async function makeStudentEnrollment(opts: {
  schoolId: string;
  classId: string;
  sessionId: string;
  ended?: boolean;
}): Promise<EnrolledStudent> {
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
      })
      .returning(),
  );
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
  const enrollment = one(
    await db
      .insert(classEnrollments)
      .values({
        schoolId: opts.schoolId,
        studentId: student.id,
        classId: opts.classId,
        sessionId: opts.sessionId,
        startedAt: new Date(),
        status: opts.ended ? "transferred" : "active",
        endedAt: opts.ended ? new Date() : null,
        endedReason: opts.ended ? "transferred" : null,
        transferredFromEnrollmentId: null,
      })
      .returning(),
  );
  return { studentId: student.id, enrollmentId: enrollment.id };
}

async function countOfferings(): Promise<number> {
  const r = one(await db.select({ n: count() }).from(classSubjects));
  return r.n;
}
async function countStudentSubjects(): Promise<number> {
  const r = one(await db.select({ n: count() }).from(studentSubjects));
  return r.n;
}

// ── Suite ─────────────────────────────────────────────────────────────

describe("offerings — integration", () => {
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
      permissions: new Set(["academics:read", "structure:manage"]),
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
    group = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: school.id,
          classId: cls.id,
          sessionId: session.id,
          name: "Religion",
          minChoices: 1,
          maxChoices: 1,
        })
        .returning(),
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  // addOfferings
  // ══════════════════════════════════════════════════════════════════════
  describe("addOfferings", () => {
    it("creates one offering", async () => {
      const subj = await makeSubject(school.id);
      const inserted = await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: true, electiveGroupId: null },
          ],
        }),
      );
      expect(inserted).toHaveLength(1);
      expect(inserted[0]!.subjectId).toBe(subj.id);
    });

    it("creates three offerings in one call", async () => {
      const a = await makeSubject(school.id);
      const b = await makeSubject(school.id);
      const c = await makeSubject(school.id);
      const inserted = await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: a.id, isCompulsory: false, electiveGroupId: null },
            { subjectId: b.id, isCompulsory: false, electiveGroupId: null },
            { subjectId: c.id, isCompulsory: false, electiveGroupId: null },
          ],
        }),
      );
      expect(inserted).toHaveLength(3);
    });

    it("400 DUPLICATE_SUBJECT when the same subjectId appears twice; nothing inserted", async () => {
      const subj = await makeSubject(school.id);
      const before = await countOfferings();

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: cls.id,
            subjects: [
              {
                subjectId: subj.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
              {
                subjectId: subj.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 400, code: "DUPLICATE_SUBJECT" });

      expect(await countOfferings()).toBe(before);
    });

    it("409 OFFERING_ALREADY_EXISTS on a subject already offered; nothing new inserted", async () => {
      const subj = await makeSubject(school.id);
      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: false, electiveGroupId: null },
          ],
        }),
      );
      const before = await countOfferings();

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: cls.id,
            subjects: [
              {
                subjectId: subj.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "OFFERING_ALREADY_EXISTS",
      });

      expect(await countOfferings()).toBe(before);
    });

    it("one archived subject in a batch rejects the whole batch", async () => {
      const good = await makeSubject(school.id);
      const bad = await makeSubject(school.id);
      // Archive one via direct update — we want to test the batch, not the archive flow.
      await db
        .update(subjects)
        .set({ archivedAt: new Date() })
        .where(eq(subjects.id, bad.id));

      const before = await countOfferings();

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: cls.id,
            subjects: [
              {
                subjectId: good.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
              { subjectId: bad.id, isCompulsory: false, electiveGroupId: null },
            ],
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404, code: "SUBJECT_NOT_FOUND" });

      // Good subject was not inserted either — batch is atomic.
      expect(await countOfferings()).toBe(before);
    });

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
      const subj = await makeSubject(school.id);

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: archivedCls.id,
            subjects: [
              {
                subjectId: subj.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
            ],
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
      const subj = await makeSubject(school.id);

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: closedCls.id,
            subjects: [
              {
                subjectId: subj.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
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
      const subj = await makeSubject(school.id);

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: otherCls.id,
            subjects: [
              {
                subjectId: subj.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
    });

    it("404 for a subject from another school", async () => {
      const otherSchool = one(
        await db
          .insert(schools)
          .values({ name: "O", slug: `o-${crypto.randomUUID()}` })
          .returning(),
      );
      const otherSubj = await makeSubject(otherSchool.id);

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: cls.id,
            subjects: [
              {
                subjectId: otherSubj.id,
                isCompulsory: false,
                electiveGroupId: null,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ httpStatus: 404, code: "SUBJECT_NOT_FOUND" });
    });

    it("404 for an elective group not in this class", async () => {
      const subj = await makeSubject(school.id);

      // A different class in the same school.
      const otherCls = one(
        await db
          .insert(classes)
          .values({
            schoolId: school.id,
            sessionId: session.id,
            levelId: level.id,
            armLabel: "Z",
            track: "general",
          })
          .returning(),
      );
      const otherGroup = one(
        await db
          .insert(electiveGroups)
          .values({
            schoolId: school.id,
            classId: otherCls.id, // ← different class
            sessionId: session.id,
            name: "Other",
            minChoices: 0,
            maxChoices: 1,
          })
          .returning(),
      );

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: cls.id, // ← target class
            subjects: [
              {
                subjectId: subj.id,
                isCompulsory: false,
                electiveGroupId: otherGroup.id, // ← group from another class
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        httpStatus: 404,
        code: "ELECTIVE_GROUP_NOT_FOUND",
      });
    });

    it("rejects compulsory offering with electiveGroupId", async () => {
      const subj = await makeSubject(school.id);

      await expect(
        db.transaction((tx) =>
          addOfferings(tx, actor, {
            classId: cls.id,
            subjects: [
              {
                subjectId: subj.id,
                isCompulsory: true,
                electiveGroupId: group.id,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: "COMPULSORY_IN_GROUP" });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Compulsory propagation
  // ══════════════════════════════════════════════════════════════════════
  describe("compulsory propagation", () => {
    it("three active enrollments → exactly three new student_subjects", async () => {
      const subj = await makeSubject(school.id);
      for (let i = 0; i < 3; i++) {
        await makeStudentEnrollment({
          schoolId: school.id,
          classId: cls.id,
          sessionId: session.id,
        });
      }
      const before = await countStudentSubjects();

      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: true, electiveGroupId: null },
          ],
        }),
      );

      expect(await countStudentSubjects()).toBe(before + 3);
    });

    it("ended enrollment gets no student_subject row", async () => {
      const subj = await makeSubject(school.id);
      await makeStudentEnrollment({
        schoolId: school.id,
        classId: cls.id,
        sessionId: session.id,
      });
      const ended = await makeStudentEnrollment({
        schoolId: school.id,
        classId: cls.id,
        sessionId: session.id,
        ended: true,
      });
      const before = await countStudentSubjects();

      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: true, electiveGroupId: null },
          ],
        }),
      );

      expect(await countStudentSubjects()).toBe(before + 1);
      // No row for the ended enrollment.
      const rows = await db
        .select()
        .from(studentSubjects)
        .where(eq(studentSubjects.enrollmentId, ended.enrollmentId));
      expect(rows).toHaveLength(0);
    });

    it("two compulsory offerings in one call → cross-product rows (3 students × 2 subjects = 6)", async () => {
      const a = await makeSubject(school.id);
      const b = await makeSubject(school.id);
      for (let i = 0; i < 3; i++) {
        await makeStudentEnrollment({
          schoolId: school.id,
          classId: cls.id,
          sessionId: session.id,
        });
      }
      const before = await countStudentSubjects();

      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: a.id, isCompulsory: true, electiveGroupId: null },
            { subjectId: b.id, isCompulsory: true, electiveGroupId: null },
          ],
        }),
      );

      expect(await countStudentSubjects()).toBe(before + 6);
    });

    it("elective offering → no auto student_subjects", async () => {
      const subj = await makeSubject(school.id);
      await makeStudentEnrollment({
        schoolId: school.id,
        classId: cls.id,
        sessionId: session.id,
      });
      const before = await countStudentSubjects();

      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            {
              subjectId: subj.id,
              isCompulsory: false,
              electiveGroupId: group.id,
            },
          ],
        }),
      );

      expect(await countStudentSubjects()).toBe(before);
    });

    it("no active enrollments → no student_subjects, but offering still created", async () => {
      const subj = await makeSubject(school.id);
      const beforeOfferings = await countOfferings();
      const beforeSS = await countStudentSubjects();

      const inserted = await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: true, electiveGroupId: null },
          ],
        }),
      );

      expect(inserted).toHaveLength(1);
      expect(await countOfferings()).toBe(beforeOfferings + 1);
      expect(await countStudentSubjects()).toBe(beforeSS);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Withdrawal
  // ══════════════════════════════════════════════════════════════════════
  describe("withdrawOffering", () => {
    it("deletes its student_subjects, leaves other offerings' rows", async () => {
      const a = await makeSubject(school.id);
      const b = await makeSubject(school.id);
      await makeStudentEnrollment({
        schoolId: school.id,
        classId: cls.id,
        sessionId: session.id,
      });

      const inserted = await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: a.id, isCompulsory: true, electiveGroupId: null },
            { subjectId: b.id, isCompulsory: true, electiveGroupId: null },
          ],
        }),
      );
      const offeringA = inserted.find((o) => o.subjectId === a.id)!;
      const offeringB = inserted.find((o) => o.subjectId === b.id)!;

      const ssCountForA = await db
        .select({ n: count() })
        .from(studentSubjects)
        .where(eq(studentSubjects.classSubjectId, offeringA.id));
      const ssCountForB = await db
        .select({ n: count() })
        .from(studentSubjects)
        .where(eq(studentSubjects.classSubjectId, offeringB.id));
      expect(ssCountForA[0]!.n).toBeGreaterThan(0);
      expect(ssCountForB[0]!.n).toBeGreaterThan(0);

      await db.transaction((tx) => withdrawOffering(tx, actor, offeringA.id));

      const afterA = await db
        .select({ n: count() })
        .from(studentSubjects)
        .where(eq(studentSubjects.classSubjectId, offeringA.id));
      const afterB = await db
        .select({ n: count() })
        .from(studentSubjects)
        .where(eq(studentSubjects.classSubjectId, offeringB.id));
      expect(afterA[0]!.n).toBe(0);
      expect(afterB[0]!.n).toBe(ssCountForB[0]!.n);
    });

    it("withdraws an offering that has no student_subjects", async () => {
      const subj = await makeSubject(school.id);
      const [offering] = await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: false, electiveGroupId: null },
          ],
        }),
      );

      await db.transaction((tx) => withdrawOffering(tx, actor, offering!.id));

      const gone = await db
        .select()
        .from(classSubjects)
        .where(eq(classSubjects.id, offering!.id));
      expect(gone).toHaveLength(0);
    });

    it("writes a class_subject.withdrawn audit row", async () => {
      const subj = await makeSubject(school.id);
      const [offering] = await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: false, electiveGroupId: null },
          ],
        }),
      );

      await db.transaction((tx) => withdrawOffering(tx, actor, offering!.id));

      const audits = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.targetId, offering!.id),
            eq(auditLog.action, "class_subject.withdrawn"),
          ),
        );
      expect(audits.length).toBeGreaterThanOrEqual(1);
    });

    it("409 SESSION_LOCKED when the session is closed", async () => {
      // Create offering while session is open, then close session.
      const subj = await makeSubject(school.id);
      const [offering] = await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: false, electiveGroupId: null },
          ],
        }),
      );

      await db
        .update(academicSessions)
        .set({ closedAt: new Date() })
        .where(eq(academicSessions.id, session.id));

      await expect(
        db.transaction((tx) => withdrawOffering(tx, actor, offering!.id)),
      ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
    });

    it("404 for an offering from another school", async () => {
      const otherSchool = one(
        await db
          .insert(schools)
          .values({ name: "O", slug: `o-${crypto.randomUUID()}` })
          .returning(),
      );
      const otherSubj = await makeSubject(otherSchool.id);
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
      const [otherOffering] = await db
        .insert(classSubjects)
        .values({
          schoolId: otherSchool.id,
          classId: otherCls.id,
          subjectId: otherSubj.id,
          isCompulsory: false,
          electiveGroupId: null,
        })
        .returning();

      await expect(
        db.transaction((tx) => withdrawOffering(tx, actor, otherOffering!.id)),
      ).rejects.toMatchObject({ httpStatus: 404, code: "OFFERING_NOT_FOUND" });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Archive guards
  // ══════════════════════════════════════════════════════════════════════
  describe("archive guards", () => {
    it("409 CLASS_HAS_OFFERINGS when class has offerings", async () => {
      const subj = await makeSubject(school.id);
      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: false, electiveGroupId: null },
          ],
        }),
      );

      await expect(
        db.transaction((tx) => archiveClass(tx, actor, cls.id)),
      ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_HAS_OFFERINGS" });
    });

    it("archives a class with no offerings", async () => {
      const archived = await db.transaction((tx) =>
        archiveClass(tx, actor, cls.id),
      );
      expect(archived.archivedAt).not.toBeNull();
    });

    it("409 SUBJECT_HAS_OFFERINGS when subject is offered", async () => {
      const subj = await makeSubject(school.id);
      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            { subjectId: subj.id, isCompulsory: false, electiveGroupId: null },
          ],
        }),
      );

      await expect(
        db.transaction((tx) => archiveSubject(tx, actor, subj.id)),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "SUBJECT_HAS_OFFERINGS",
      });
    });

    it("archives a subject with no offerings", async () => {
      const subj = await makeSubject(school.id);
      const archived = await db.transaction((tx) =>
        archiveSubject(tx, actor, subj.id),
      );
      expect(archived.archivedAt).not.toBeNull();
    });

    it("409 ELECTIVE_GROUP_HAS_OFFERINGS when group has offerings", async () => {
      const subj = await makeSubject(school.id);
      await db.transaction((tx) =>
        addOfferings(tx, actor, {
          classId: cls.id,
          subjects: [
            {
              subjectId: subj.id,
              isCompulsory: false,
              electiveGroupId: group.id,
            },
          ],
        }),
      );

      await expect(
        db.transaction((tx) => archiveElectiveGroup(tx, actor, group.id)),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "ELECTIVE_GROUP_HAS_OFFERINGS",
      });
    });

    it("archives an elective group with no offerings", async () => {
      const archived = await db.transaction((tx) =>
        archiveElectiveGroup(tx, actor, group.id),
      );
      expect(archived.archivedAt).not.toBeNull();
    });
  });
});
