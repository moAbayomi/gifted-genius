import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../../../src/db/client.js";
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
  studentProfiles,
  classEnrollments,
  studentSubjects,
  type School,
  type AcademicSession,
  type Class,
  type Level,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { getClassRoster } from "../../../../src/modules/academics/enrollment/roster.js";
import { setElectives } from "../../../../src/modules/academics/enrollment/electives.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

let school: School;
let actor: Actor;
let level: Level;
let session: AcademicSession;
let cls: Class;

async function makeStudent(suffix: number) {
  const user = one(
    await db
      .insert(users)
      .values({
        email: `roster-${suffix}-${crypto.randomUUID().slice(0, 8)}@test`,
        firstName: `Student${suffix}`,
        lastName: "Roster",
      })
      .returning(),
  );
  const membership = one(
    await db
      .insert(memberships)
      .values({ userId: user.id, schoolId: school.id })
      .returning(),
  );
  const profile = one(
    await db
      .insert(studentProfiles)
      .values({
        schoolId: school.id,
        membershipId: membership.id,
        admissionNumber: `ROSTER-${String(suffix).padStart(3, "0")}`,
      })
      .returning(),
  );
  const enrollment = one(
    await db
      .insert(classEnrollments)
      .values({
        schoolId: school.id,
        studentId: profile.id,
        classId: cls.id,
        sessionId: session.id,
        startedAt: new Date(),
        status: "active",
      })
      .returning(),
  );
  return { profile, enrollment };
}

describe("getClassRoster", () => {
  beforeEach(async () => {
    school = one(
      await db
        .insert(schools)
        .values({ name: "Roster School", slug: `roster-${crypto.randomUUID()}` })
        .returning(),
    );
    const admin = one(
      await db
        .insert(users)
        .values({
          email: `admin-${crypto.randomUUID()}@test`,
          firstName: "Admin",
          lastName: "Test",
        })
        .returning(),
    );
    const membership = one(
      await db
        .insert(memberships)
        .values({ userId: admin.id, schoolId: school.id })
        .returning(),
    );
    actor = {
      userId: admin.id,
      membershipId: membership.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(["enrollments:read", "enrollments:manage"]),
    };

    level = one(
      await db
        .insert(levels)
        .values({ schoolId: school.id, name: "JSS1", sequence: 1, stage: "junior" })
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

  it("uses a fixed two queries for a class of 40", async () => {
    for (let i = 0; i < 40; i++) await makeStudent(i + 1);

    let selects = 0;
    const counted = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "select") {
          return (...args: unknown[]) => {
            selects += 1;
            return (target.select as (...a: unknown[]) => unknown)(...args);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const roster = await getClassRoster(counted as typeof db, actor, {
      classId: cls.id,
    });

    expect(roster.students).toHaveLength(40);
    expect(selects).toBe(2);
  });

  it("returns subjects and completeness, and groups subjects in memory", async () => {
    const { enrollment } = await makeStudent(1);
    const compulsorySubject = one(
      await db
        .insert(subjects)
        .values({
          schoolId: school.id,
          code: "MTH",
          name: "Mathematics",
        })
        .returning(),
    );
    const offering = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: school.id,
          classId: cls.id,
          subjectId: compulsorySubject.id,
          isCompulsory: true,
        })
        .returning(),
    );
    await db.insert(studentSubjects).values({
      schoolId: school.id,
      enrollmentId: enrollment.id,
      classId: cls.id,
      sessionId: session.id,
      classSubjectId: offering.id,
    });

    const group = one(
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
    const electiveSubject = one(
      await db
        .insert(subjects)
        .values({
          schoolId: school.id,
          code: "CRS",
          name: "Christian Religious Studies",
        })
        .returning(),
    );
    const elective = one(
      await db
        .insert(classSubjects)
        .values({
          schoolId: school.id,
          classId: cls.id,
          subjectId: electiveSubject.id,
          isCompulsory: false,
          electiveGroupId: group.id,
        })
        .returning(),
    );

    const before = await getClassRoster(db, actor, { classId: cls.id });
    expect(before.students[0]!.subjects).toHaveLength(1);
    expect(before.students[0]!.complete).toBe(false); // group min 1 not met

    await db.transaction((tx) =>
      setElectives(tx, actor, {
        enrollmentId: enrollment.id,
        offeringIds: [elective.id],
      }),
    );

    const after = await getClassRoster(db, actor, { classId: cls.id });
    expect(after.students[0]!.subjects).toHaveLength(2);
    expect(after.students[0]!.complete).toBe(true);
  });

  it("404s for a class in another school", async () => {
    const other = one(
      await db
        .insert(schools)
        .values({ name: "Other", slug: `other-${crypto.randomUUID()}` })
        .returning(),
    );
    const otherLevel = one(
      await db
        .insert(levels)
        .values({ schoolId: other.id, name: "JSS1", sequence: 1, stage: "junior" })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: other.id, label: "2025/2026" })
        .returning(),
    );
    const otherClass = one(
      await db
        .insert(classes)
        .values({
          schoolId: other.id,
          sessionId: otherSession.id,
          levelId: otherLevel.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );

    await expect(
      getClassRoster(db, actor, { classId: otherClass.id }),
    ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
  });
});
