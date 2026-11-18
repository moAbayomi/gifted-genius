import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import {
  schools,
  users,
  memberships,
  academicSessions,
  levels,
  classes,
  subjects,
  classSubjects,
  subjectTeacherAssignments,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";

function hasPgConstraint(err: unknown, name: string): boolean {
  let cur: unknown = err;
  while (cur && typeof cur === "object") {
    const e = cur as { constraint?: string; cause?: unknown };
    if (e.constraint === name) return true;
    cur = e.cause;
  }
  return false;
}

async function expectViolation(p: Promise<unknown>, name: string) {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  if (caught === undefined) throw new Error(`Expected ${name}, query succeeded`);
  if (!hasPgConstraint(caught, name)) {
    throw new Error(`Expected ${name}, got: ${(caught as Error).message}`);
  }
}

describe("assignment constraints", () => {
  let schoolA: typeof schools.$inferSelect;
  let schoolB: typeof schools.$inferSelect;
  let teacherA: typeof memberships.$inferSelect;
  let teacherB: typeof memberships.$inferSelect;
  let classA: typeof classes.$inferSelect;
  let classB: typeof classes.$inferSelect;
  let offeringA: typeof classSubjects.$inferSelect;

  beforeEach(async () => {
    schoolA = one(await db.insert(schools).values({ name: "A", slug: `a-${crypto.randomUUID()}` }).returning());
    schoolB = one(await db.insert(schools).values({ name: "B", slug: `b-${crypto.randomUUID()}` }).returning());

    const userA = one(await db.insert(users).values({ email: `a-${crypto.randomUUID()}@test`, firstName: "A", lastName: "T" }).returning());
    const userB = one(await db.insert(users).values({ email: `b-${crypto.randomUUID()}@test`, firstName: "B", lastName: "T" }).returning());
    teacherA = one(await db.insert(memberships).values({ userId: userA.id, schoolId: schoolA.id }).returning());
    teacherB = one(await db.insert(memberships).values({ userId: userB.id, schoolId: schoolB.id }).returning());

    const sessionA = one(await db.insert(academicSessions).values({ schoolId: schoolA.id, label: "2026/2027" }).returning());
    const sessionB = one(await db.insert(academicSessions).values({ schoolId: schoolB.id, label: "2026/2027" }).returning());
    const levelA = one(await db.insert(levels).values({ schoolId: schoolA.id, name: "JSS 1", sequence: 1, stage: "junior" }).returning());
    const levelB = one(await db.insert(levels).values({ schoolId: schoolB.id, name: "JSS 1", sequence: 1, stage: "junior" }).returning());
    classA = one(await db.insert(classes).values({ schoolId: schoolA.id, sessionId: sessionA.id, levelId: levelA.id, armLabel: "A" }).returning());
    classB = one(await db.insert(classes).values({ schoolId: schoolA.id, sessionId: sessionA.id, levelId: levelA.id, armLabel: "B" }).returning());
    void sessionB; void levelB;

    const subjectA = one(await db.insert(subjects).values({ schoolId: schoolA.id, code: "ENG", name: "English" }).returning());
    offeringA = one(await db.insert(classSubjects).values({ schoolId: schoolA.id, classId: classA.id, subjectId: subjectA.id, isCompulsory: true }).returning());
  });

  it("accepts a same-school form teacher and refuses another school", async () => {
    const ok = one(await db.update(classes).set({ formTeacherMembershipId: teacherA.id }).where(eq(classes.id, classA.id)).returning());
    expect(ok.formTeacherMembershipId).toBe(teacherA.id);

    await expectViolation(
      db.update(classes).set({ formTeacherMembershipId: teacherB.id }).where(eq(classes.id, classA.id)),
      "classes_form_teacher_membership_school_fk",
    );
  });

  it("refuses two active assignments for one offering/teacher, accepts after ending the first", async () => {
    const first = one(await db.insert(subjectTeacherAssignments).values({
      schoolId: schoolA.id, classId: classA.id, classSubjectId: offeringA.id, teacherMembershipId: teacherA.id,
    }).returning());

    await expectViolation(
      db.insert(subjectTeacherAssignments).values({
        schoolId: schoolA.id, classId: classA.id, classSubjectId: offeringA.id, teacherMembershipId: teacherA.id,
      }),
      "subject_teacher_assignments_active_uq",
    );

    await db.update(subjectTeacherAssignments).set({ endedAt: new Date() }).where(eq(subjectTeacherAssignments.id, first.id));
    const second = one(await db.insert(subjectTeacherAssignments).values({
      schoolId: schoolA.id, classId: classA.id, classSubjectId: offeringA.id, teacherMembershipId: teacherA.id,
    }).returning());
    expect(second.endedAt).toBeNull();
  });

  it("refuses an assignment whose class does not match the offering", async () => {
    await expectViolation(
      db.insert(subjectTeacherAssignments).values({
        schoolId: schoolA.id, classId: classB.id, classSubjectId: offeringA.id, teacherMembershipId: teacherA.id,
      }),
      "subject_teacher_assignments_class_subject_class_fk",
    );
  });

  it("refuses a teacher membership from another school", async () => {
    await expectViolation(
      db.insert(subjectTeacherAssignments).values({
        schoolId: schoolA.id, classId: classA.id, classSubjectId: offeringA.id, teacherMembershipId: teacherB.id,
      }),
      "subject_teacher_assignments_teacher_membership_school_fk",
    );
  });

  it("accepts a correct assignment (control)", async () => {
    const row = one(await db.insert(subjectTeacherAssignments).values({
      schoolId: schoolA.id, classId: classA.id, classSubjectId: offeringA.id, teacherMembershipId: teacherA.id,
    }).returning());
    expect(row.classId).toBe(classA.id);
    expect(row.classSubjectId).toBe(offeringA.id);
  });
});
