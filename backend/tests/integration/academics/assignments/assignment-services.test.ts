import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  schools, users, memberships, membershipRoles, roles,
  academicSessions, levels, classes, subjects, classSubjects,
  subjectTeacherAssignments,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  assignFormTeacher,
  replaceSubjectTeacher,
} from "../../../../src/modules/academics/assignments/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

let school: typeof schools.$inferSelect;
let actor: Actor;
let session: typeof academicSessions.$inferSelect;
let cls: typeof classes.$inferSelect;
let offering: typeof classSubjects.$inferSelect;
let staffA: typeof memberships.$inferSelect;
let staffB: typeof memberships.$inferSelect;
let studentMember: typeof memberships.$inferSelect;

async function makeMember(kind: "staff" | "student") {
  const user = one(await db.insert(users).values({
    email: `${kind}-${crypto.randomUUID()}@test`, firstName: kind, lastName: "Member",
  }).returning());
  const membership = one(await db.insert(memberships).values({
    userId: user.id, schoolId: school.id, status: "active",
  }).returning());
  const role = one(await db.insert(roles).values({
    schoolId: school.id, key: `${kind}-${crypto.randomUUID().slice(0, 6)}`,
    name: kind, kind, rank: kind === "staff" ? 50 : 10, isSystem: false,
  }).returning());
  await db.insert(membershipRoles).values({
    membershipId: membership.id, roleId: role.id, schoolId: school.id,
  });
  return membership;
}

describe("assignment services", () => {
  beforeEach(async () => {
    school = one(await db.insert(schools).values({
      name: "Assignments", slug: `asn-${crypto.randomUUID()}`,
    }).returning());
    session = one(await db.insert(academicSessions).values({
      schoolId: school.id, label: "2026/2027",
    }).returning());
    const level = one(await db.insert(levels).values({
      schoolId: school.id, name: "JSS 1", sequence: 1, stage: "junior",
    }).returning());
    cls = one(await db.insert(classes).values({
      schoolId: school.id, sessionId: session.id, levelId: level.id, armLabel: "A", track: "general",
    }).returning());
    const subject = one(await db.insert(subjects).values({
      schoolId: school.id, code: "ENG", name: "English",
    }).returning());
    offering = one(await db.insert(classSubjects).values({
      schoolId: school.id, classId: cls.id, subjectId: subject.id, isCompulsory: true,
    }).returning());
    staffA = await makeMember("staff");
    staffB = await makeMember("staff");
    studentMember = await makeMember("student");
    actor = {
      userId: staffA.userId,
      membershipId: staffA.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(["assignments:manage"]),
    };
  });

  it("refuses a student-kind target with NOT_STAFF, and accepts staff", async () => {
    await expect(db.transaction((tx) => assignFormTeacher(tx, actor, {
      classId: cls.id, teacherMembershipId: studentMember.id,
    }))).rejects.toMatchObject({ httpStatus: 403, code: "TEACHER_NOT_STAFF" });

    const updated = await db.transaction((tx) => assignFormTeacher(tx, actor, {
      classId: cls.id, teacherMembershipId: staffA.id,
    }));
    expect(updated.formTeacherMembershipId).toBe(staffA.id);
  });

  it("keeps history when replacing a subject teacher", async () => {
    await db.transaction((tx) => replaceSubjectTeacher(tx, actor, {
      classSubjectId: offering.id, teacherMembershipId: staffA.id,
    }));
    await db.transaction((tx) => replaceSubjectTeacher(tx, actor, {
      classSubjectId: offering.id, teacherMembershipId: staffB.id,
    }));

    const rows = await db.select().from(subjectTeacherAssignments)
      .where(eq(subjectTeacherAssignments.classSubjectId, offering.id));
    expect(rows).toHaveLength(2);
    const active = rows.filter((r) => r.endedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.teacherMembershipId).toBe(staffB.id);
  });

  it("refuses assignment writes in a locked session", async () => {
    await db.update(academicSessions).set({ closedAt: new Date() }).where(eq(academicSessions.id, session.id));
    await expect(db.transaction((tx) => assignFormTeacher(tx, actor, {
      classId: cls.id, teacherMembershipId: staffA.id,
    }))).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });
});
