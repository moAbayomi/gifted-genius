import { describe, it, expect, beforeEach } from "vitest";
import { count, eq } from "drizzle-orm";
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
  electiveGroups,
  subjectTeacherAssignments,
  auditLog,
  type School,
  type AcademicSession,
  type Level,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { rolloverSession } from "../../../src/modules/academics/rollover.js";
import type { Actor } from "../../../src/modules/rbac/can.js";

let school: School;
let actor: Actor;
let level: Level;
let fromSession: AcademicSession;
let toSession: AcademicSession;

async function tableCounts() {
  const offerings = one(await db.select({ n: count() }).from(classSubjects));
  const groups = one(await db.select({ n: count() }).from(electiveGroups));
  const classesCount = one(await db.select({ n: count() }).from(classes));
  const audits = one(await db.select({ n: count() }).from(auditLog));
  return {
    offerings: offerings.n,
    groups: groups.n,
    classes: classesCount.n,
    audits: audits.n,
  };
}

describe("rolloverSession", () => {
  beforeEach(async () => {
    school = one(
      await db
        .insert(schools)
        .values({ name: "Rollover School", slug: `roll-${crypto.randomUUID()}` })
        .returning(),
    );
    const user = one(
      await db
        .insert(users)
        .values({
          email: `roll-${crypto.randomUUID()}@test`,
          firstName: "Roll",
          lastName: "Admin",
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
      permissions: new Set(["structure:manage"]),
    };

    level = one(
      await db
        .insert(levels)
        .values({ schoolId: school.id, name: "JSS1", sequence: 1, stage: "junior" })
        .returning(),
    );
    fromSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2025/2026" })
        .returning(),
    );
    toSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2026/2027" })
        .returning(),
    );
  });

  it("copies classes, groups and active offerings; second run is a no-op", async () => {
    const classA = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: fromSession.id,
          levelId: level.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );
    const classB = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: fromSession.id,
          levelId: level.id,
          armLabel: "B",
          track: "general",
        })
        .returning(),
    );
    const math = one(
      await db
        .insert(subjects)
        .values({ schoolId: school.id, code: "MTH", name: "Mathematics" })
        .returning(),
    );
    const english = one(
      await db
        .insert(subjects)
        .values({ schoolId: school.id, code: "ENG", name: "English" })
        .returning(),
    );
    const crs = one(
      await db
        .insert(subjects)
        .values({ schoolId: school.id, code: "CRS", name: "CRS" })
        .returning(),
    );
    const group = one(
      await db
        .insert(electiveGroups)
        .values({
          schoolId: school.id,
          classId: classA.id,
          sessionId: fromSession.id,
          name: "Religion",
          minChoices: 1,
          maxChoices: 1,
        })
        .returning(),
    );
    await db.insert(classSubjects).values([
      {
        schoolId: school.id,
        classId: classA.id,
        subjectId: math.id,
        isCompulsory: true,
        electiveGroupId: null,
      },
      {
        schoolId: school.id,
        classId: classA.id,
        subjectId: crs.id,
        isCompulsory: false,
        electiveGroupId: group.id,
      },
      {
        schoolId: school.id,
        classId: classB.id,
        subjectId: english.id,
        isCompulsory: true,
        electiveGroupId: null,
      },
    ]);

    const first = await db.transaction((tx) =>
      rolloverSession(tx, actor, {
        fromSessionId: fromSession.id,
        toSessionId: toSession.id,
      }),
    );
    expect(first.classesCloned).toBe(2);
    expect(first.groupsCopied).toBe(1);
    expect(first.offeringsCopied).toBe(3);

    const targetClasses = await db
      .select()
      .from(classes)
      .where(eq(classes.sessionId, toSession.id));
    expect(targetClasses).toHaveLength(2);
    const targetA = targetClasses.find((c) => c.armLabel === "A")!;

    const targetGroups = await db
      .select()
      .from(electiveGroups)
      .where(eq(electiveGroups.classId, targetA.id));
    expect(targetGroups).toHaveLength(1);
    expect(targetGroups[0]!.name).toBe("Religion");

    const targetOfferings = await db
      .select()
      .from(classSubjects)
      .where(eq(classSubjects.classId, targetA.id));
    expect(targetOfferings).toHaveLength(2);
    const targetCrs = targetOfferings.find((o) => o.subjectId === crs.id)!;
    expect(targetCrs.electiveGroupId).toBe(targetGroups[0]!.id);
    expect(targetCrs.isCompulsory).toBe(false);

    const beforeSecond = await tableCounts();
    const second = await db.transaction((tx) =>
      rolloverSession(tx, actor, {
        fromSessionId: fromSession.id,
        toSessionId: toSession.id,
      }),
    );
    expect(second).toEqual({
      classesCloned: 0,
      groupsCopied: 0,
      offeringsCopied: 0,
      formAssignmentsCopied: 0,
      subjectAssignmentsCopied: 0,
      skippedTeachers: [],
    });
    expect(await tableCounts()).toEqual(beforeSecond);
  });


  it("copies active assignments and reports inactive teachers", async () => {
    const cls = one(
      await db.insert(classes).values({
        schoolId: school.id, sessionId: fromSession.id, levelId: level.id,
        armLabel: "A", track: "general",
      }).returning(),
    );
    const subject = one(
      await db.insert(subjects).values({
        schoolId: school.id, code: "ASN", name: "Assignment Subject",
      }).returning(),
    );
    const offering = one(
      await db.insert(classSubjects).values({
        schoolId: school.id, classId: cls.id, subjectId: subject.id, isCompulsory: true,
      }).returning(),
    );
    const activeUser = one(await db.insert(users).values({
      email: `active-${crypto.randomUUID()}@test`, firstName: "Active", lastName: "Teacher",
    }).returning());
    const inactiveUser = one(await db.insert(users).values({
      email: `inactive-${crypto.randomUUID()}@test`, firstName: "Inactive", lastName: "Teacher",
    }).returning());
    const activeTeacher = one(await db.insert(memberships).values({
      userId: activeUser.id, schoolId: school.id, status: "active",
    }).returning());
    const inactiveTeacher = one(await db.insert(memberships).values({
      userId: inactiveUser.id, schoolId: school.id, status: "suspended",
    }).returning());
    await db.update(classes).set({ formTeacherMembershipId: activeTeacher.id }).where(eq(classes.id, cls.id));
    await db.insert(subjectTeacherAssignments).values({
      schoolId: school.id, classId: cls.id, classSubjectId: offering.id,
      teacherMembershipId: inactiveTeacher.id,
    });

    const first = await db.transaction((tx) => rolloverSession(tx, actor, {
      fromSessionId: fromSession.id, toSessionId: toSession.id,
    }));
    expect(first.formAssignmentsCopied).toBe(1);
    expect(first.subjectAssignmentsCopied).toBe(0);
    expect(first.skippedTeachers).toContainEqual({
      membershipId: inactiveTeacher.id, reason: "MEMBERSHIP_INACTIVE",
    });

    const target = one(await db.select().from(classes).where(eq(classes.sessionId, toSession.id)));
    expect(target.formTeacherMembershipId).toBe(activeTeacher.id);

    const second = await db.transaction((tx) => rolloverSession(tx, actor, {
      fromSessionId: fromSession.id, toSessionId: toSession.id,
    }));
    expect(second.formAssignmentsCopied).toBe(0);
    expect(second.subjectAssignmentsCopied).toBe(0);
    expect(second.skippedTeachers).toContainEqual({
      membershipId: inactiveTeacher.id, reason: "MEMBERSHIP_INACTIVE",
    });
  });

  it("rejects the same source and target session", async () => {
    await expect(
      db.transaction((tx) =>
        rolloverSession(tx, actor, {
          fromSessionId: fromSession.id,
          toSessionId: fromSession.id,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "SAME_SESSION" });
  });
});
