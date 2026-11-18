import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import buildApp from "../../../src/app.js";
import { loginAgent, TEST_PASSWORD } from "../../helpers/auth.js";
import { one } from "../../../src/shared/utils/assert.js";
import {
  users, memberships, levels, classes, classSubjects,
  studentProfiles, classEnrollments, subjectTeacherAssignments,
} from "../../../src/db/schema/index.js";
import { apiPath } from "../../helpers/api.js";

/** Every scoped list endpoint goes in this table. */
const scopedLists = [
  { name: "GET /enrollments", path: apiPath("/enrollments") },
];

describe("scoped list loop", () => {
  let app: ReturnType<typeof buildApp>;
  let scopedClassId: string;
  let outOfScopeClassId: string;

  beforeEach(async () => {
    await seed({ password: TEST_PASSWORD });
    app = buildApp();

    const teacher = one(
      await db.select().from(users).where(eq(users.email, "teacher@demo.test")),
    );
    const teacherMembership = one(
      await db.select().from(memberships).where(eq(memberships.userId, teacher.id)),
    );
    const jss2 = one(await db.select().from(levels).where(eq(levels.name, "JSS 2")));
    const jss1 = one(await db.select().from(levels).where(eq(levels.name, "JSS 1")));
    const scoped = one(
      await db.select().from(classes).where(and(eq(classes.levelId, jss2.id), eq(classes.armLabel, "A"))),
    );
    const out = one(
      await db.select().from(classes).where(and(eq(classes.levelId, jss1.id), eq(classes.armLabel, "A"))),
    );
    scopedClassId = scoped.id;
    outOfScopeClassId = out.id;
    const offering = one(
      await db.select().from(classSubjects).where(eq(classSubjects.classId, scoped.id)),
    );
    await db.update(classes).set({ formTeacherMembershipId: teacherMembership.id }).where(eq(classes.id, scoped.id));
    await db.insert(subjectTeacherAssignments).values({
      schoolId: scoped.schoolId,
      classId: scoped.id,
      classSubjectId: offering.id,
      teacherMembershipId: teacherMembership.id,
    });

    const user = one(await db.insert(users).values({
      email: `out-${crypto.randomUUID()}@test`, firstName: "Out", lastName: "Scope",
    }).returning());
    const membership = one(await db.insert(memberships).values({
      userId: user.id, schoolId: scoped.schoolId,
    }).returning());
    const student = one(await db.insert(studentProfiles).values({
      schoolId: scoped.schoolId, membershipId: membership.id,
      admissionNumber: `OUT-${crypto.randomUUID().slice(0, 8)}`,
    }).returning());
    await db.insert(classEnrollments).values({
      schoolId: scoped.schoolId, studentId: student.id, classId: out.id,
      sessionId: scoped.sessionId, startedAt: new Date(), status: "active",
    });
  });

  it.each(scopedLists)("$name excludes every out-of-scope row", async ({ path }) => {
    const agent = await loginAgent(app, "teacher@demo.test");
    const res = await agent.get(path);
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.classId).toBe(scopedClassId);
      expect(row.classId).not.toBe(outOfScopeClassId);
    }
  });
});
