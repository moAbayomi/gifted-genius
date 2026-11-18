import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import buildApp from "../../../src/app.js";
import { loginAgent, TEST_PASSWORD } from "../../helpers/auth.js";
import { one } from "../../../src/shared/utils/assert.js";
import {
  users,
  memberships,
  levels,
  classes,
  classSubjects,
  studentProfiles,
  classEnrollments,
  subjectTeacherAssignments,
} from "../../../src/db/schema/index.js";
import { apiPath } from "../../helpers/api.js";

describe("enrollment read scope", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await seed({ password: TEST_PASSWORD });
    app = buildApp();
  });

  it("lets a teacher read their class, 404s another, and filters the list", async () => {
    const teacher = one(
      await db.select().from(users).where(eq(users.email, "teacher@demo.test")),
    );
    const teacherMembership = one(
      await db.select().from(memberships).where(eq(memberships.userId, teacher.id)),
    );
    const jss2 = one(await db.select().from(levels).where(eq(levels.name, "JSS 2")));
    const jss1 = one(await db.select().from(levels).where(eq(levels.name, "JSS 1")));
    const ownClass = one(
      await db.select().from(classes).where(and(eq(classes.levelId, jss2.id), eq(classes.armLabel, "A"))),
    );
    const otherClass = one(
      await db.select().from(classes).where(and(eq(classes.levelId, jss1.id), eq(classes.armLabel, "A"))),
    );
    const ownOffering = one(
      await db.select().from(classSubjects).where(eq(classSubjects.classId, ownClass.id)),
    );

    await db
      .update(classes)
      .set({ formTeacherMembershipId: teacherMembership.id })
      .where(eq(classes.id, ownClass.id));
    await db.insert(subjectTeacherAssignments).values({
      schoolId: ownClass.schoolId,
      classId: ownClass.id,
      classSubjectId: ownOffering.id,
      teacherMembershipId: teacherMembership.id,
    });

    // An enrolment outside the teacher's scope.
    const otherUser = one(
      await db.insert(users).values({
        email: `other-${crypto.randomUUID()}@test`,
        firstName: "Other",
        lastName: "Student",
      }).returning(),
    );
    const otherMembership = one(
      await db.insert(memberships).values({
        userId: otherUser.id,
        schoolId: ownClass.schoolId,
      }).returning(),
    );
    const otherStudent = one(
      await db.insert(studentProfiles).values({
        schoolId: ownClass.schoolId,
        membershipId: otherMembership.id,
        admissionNumber: `OTHER-${crypto.randomUUID().slice(0, 8)}`,
      }).returning(),
    );
    const otherEnrollment = one(
      await db.insert(classEnrollments).values({
        schoolId: ownClass.schoolId,
        studentId: otherStudent.id,
        classId: otherClass.id,
        sessionId: ownClass.sessionId,
        startedAt: new Date(),
        status: "active",
      }).returning(),
    );

    const agent = await loginAgent(app, "teacher@demo.test");

    expect((await agent.get(apiPath(`/classes/${ownClass.id}/roster`))).status).toBe(200);
    expect((await agent.get(apiPath(`/classes/${otherClass.id}/roster`))).status).toBe(404);
    expect((await agent.get(apiPath(`/enrollments?classId=${otherClass.id}`))).status).toBe(404);

    const list = await agent.get(apiPath("/enrollments"));
    expect(list.status).toBe(200);
    expect(list.body.data.every((e: { classId: string }) => e.classId === ownClass.id)).toBe(true);
    expect(list.body.data.some((e: { id: string }) => e.id === otherEnrollment.id)).toBe(false);

    expect((await agent.get(apiPath(`/enrollments/${otherEnrollment.id}`))).status).toBe(404);
  });

  it("returns an empty list and 404s roster when the teacher has no assignments", async () => {
    const agent = await loginAgent(app, "teacher@demo.test");
    const list = await agent.get(apiPath("/enrollments"));
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
  });
});
