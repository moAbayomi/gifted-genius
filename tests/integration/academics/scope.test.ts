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
  classes,
  levels,
  classSubjects,
  subjectTeacherAssignments,
} from "../../../src/db/schema/index.js";

describe("actor scope", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    await seed({ password: TEST_PASSWORD });
    app = buildApp();
  });

  it("gives the demo teacher exactly their form class and taught offering", async () => {
    const teacherUser = one(
      await db.select().from(users).where(eq(users.email, "teacher@demo.test")),
    );
    const teacherMembership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, teacherUser.id)),
    );
    const jss2 = one(
      await db.select().from(levels).where(eq(levels.name, "JSS 2")),
    );
    const formClass = one(
      await db
        .select()
        .from(classes)
        .where(
          and(
            eq(classes.levelId, jss2.id),
            eq(classes.armLabel, "A"),
          ),
        ),
    );
    const offering = one(
      await db
        .select()
        .from(classSubjects)
        .where(eq(classSubjects.classId, formClass.id)),
    );

    await db
      .update(classes)
      .set({ formTeacherMembershipId: teacherMembership.id })
      .where(eq(classes.id, formClass.id));
    await db.insert(subjectTeacherAssignments).values({
      schoolId: formClass.schoolId,
      classId: formClass.id,
      classSubjectId: offering.id,
      teacherMembershipId: teacherMembership.id,
    });

    const agent = await loginAgent(app, "teacher@demo.test");
    const res = await agent.get("/__test/scope");

    expect(res.status).toBe(200);
    expect(res.body.scope.formTeacherClassIds).toEqual([formClass.id]);
    expect(res.body.scope.offeringIds).toEqual([offering.id]);
    expect(res.body.scope.classIds).toEqual([]);
    expect(res.body.scope.sessionId).toBeTruthy();

    const assignments = await agent.get("/me/assignments");
    expect(assignments.status).toBe(200);
    expect(assignments.body.session.label).toBe("2026/2027");
    expect(assignments.body.formTeacherClasses).toHaveLength(1);
    expect(assignments.body.formTeacherClasses[0].displayName).toBe("JSS 2 A");
    expect(assignments.body.subjectOfferings).toHaveLength(1);
    expect(assignments.body.subjectOfferings[0].id).toBe(offering.id);
    expect(assignments.body.subjectOfferings[0].subject.name).toBeTruthy();
  });

  it("refuses student-kind and guardian-kind members", async () => {
    const studentMembership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.username, "jss1-2026-001")),
    );
    await db
      .update(users)
      .set({ email: "student-scope@demo.test" })
      .where(eq(users.id, studentMembership.userId));

    const studentAgent = await loginAgent(app, "student-scope@demo.test");
    expect((await studentAgent.get("/me/assignments")).status).toBe(403);

    const guardian = await loginAgent(app, "guardian@demo.test");
    expect((await guardian.get("/me/assignments")).status).toBe(403);
  });
});
