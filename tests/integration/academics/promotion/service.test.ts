import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  users, memberships, studentProfiles, academicSessions, levels,
  classes, subjects, classSubjects, classEnrollments, studentSubjects,
  type School,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { createSchoolWithDefaults } from "../../../../src/modules/schools/service.js";
import {
  previewPromotions, commitPromotion,
} from "../../../../src/modules/academics/promotion/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

let school: School;
let actor: Actor;
let sourceSession: typeof academicSessions.$inferSelect;
let targetSession: typeof academicSessions.$inferSelect;
let sourceClass: typeof classes.$inferSelect;
let targetClass: typeof classes.$inferSelect;
let targetOffering: typeof classSubjects.$inferSelect;
let sourceEnrollment: typeof classEnrollments.$inferSelect;

async function setup(targetHasOffering = true) {
  const owner = one(await db.insert(users).values({
    email: `owner-${crypto.randomUUID()}@test`, firstName: "Owner", lastName: "Promotion",
  }).returning());
  const created = await createSchoolWithDefaults({
    name: "Promotion School", slug: `prom-${crypto.randomUUID()}`, ownerUserId: owner.id,
  });
  school = created.school;
  actor = {
    userId: owner.id, membershipId: created.ownerMembership.id, schoolId: school.id,
    rank: 100, permissions: new Set(["enrollments:manage"]),
  };
  sourceSession = one(await db.insert(academicSessions).values({ schoolId: school.id, label: "2026/2027" }).returning());
  targetSession = one(await db.insert(academicSessions).values({ schoolId: school.id, label: "2027/2028" }).returning());
  const jss1 = one(await db.select().from(levels).where(and(eq(levels.schoolId, school.id), eq(levels.name, "JSS 1"))));
  const jss2 = one(await db.select().from(levels).where(and(eq(levels.schoolId, school.id), eq(levels.name, "JSS 2"))));
  sourceClass = one(await db.insert(classes).values({
    schoolId: school.id, sessionId: sourceSession.id, levelId: jss1.id, armLabel: "A", track: "general",
  }).returning());
  targetClass = one(await db.insert(classes).values({
    schoolId: school.id, sessionId: targetSession.id, levelId: jss2.id, armLabel: "A", track: "general",
  }).returning());
  const subject = one(await db.insert(subjects).values({
    schoolId: school.id, code: `MTH-${crypto.randomUUID().slice(0, 5)}`, name: "Mathematics",
  }).returning());
  if (targetHasOffering) {
    targetOffering = one(await db.insert(classSubjects).values({
      schoolId: school.id, classId: targetClass.id, subjectId: subject.id, isCompulsory: true,
    }).returning());
  }
  const studentUser = one(await db.insert(users).values({
    email: `student-${crypto.randomUUID()}@test`, firstName: "Promoted", lastName: "Student",
  }).returning());
  const membership = one(await db.insert(memberships).values({
    userId: studentUser.id, schoolId: school.id, status: "active",
  }).returning());
  const profile = one(await db.insert(studentProfiles).values({
    schoolId: school.id, membershipId: membership.id,
    admissionNumber: `P-${crypto.randomUUID().slice(0, 8)}`,
  }).returning());
  sourceEnrollment = one(await db.insert(classEnrollments).values({
    schoolId: school.id, studentId: profile.id, classId: sourceClass.id,
    sessionId: sourceSession.id, startedAt: new Date(), status: "active",
  }).returning());
}

describe("promotion preview and commit", () => {
  beforeEach(async () => setup());

  it("previews without writing and groups by target class", async () => {
    const before = await db.select().from(classEnrollments);
    const preview = await previewPromotions(db, actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
    });
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({ action: "promote", targetClassId: targetClass.id, warnings: [] });
    expect(preview.groups[0]!.targetClassId).toBe(targetClass.id);
    expect(preview.groups[0]!.count).toBe(1);
    expect(await db.select().from(classEnrollments)).toHaveLength(before.length);
  });

  it("warns when the target class has no offerings", async () => {
    await db.delete(classSubjects).where(eq(classSubjects.classId, targetClass.id));
    const preview = await previewPromotions(db, actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
    });
    expect(preview.rows[0]!.warnings).toContain("NO_OFFERINGS");
    expect(preview.counts.noOfferings).toBe(1);
  });

  it("commits, creates compulsory subjects, and is idempotent", async () => {
    const first = await commitPromotion(actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
      rows: [{ enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id }],
    });
    expect(first).toMatchObject({ created: 1, sourceEnded: 1, subjectsCreated: 1, skipped: [] });

    const old = one(await db.select().from(classEnrollments).where(eq(classEnrollments.id, sourceEnrollment.id)));
    expect(old.status).toBe("transferred");
    expect(old.endedReason).toBe("promoted");
    const newRow = one(await db.select().from(classEnrollments).where(and(
      eq(classEnrollments.studentId, sourceEnrollment.studentId),
      eq(classEnrollments.sessionId, targetSession.id),
    )));
    expect(newRow.status).toBe("active");
    const subjects = await db.select().from(studentSubjects).where(eq(studentSubjects.enrollmentId, newRow.id));
    expect(subjects).toHaveLength(1);
    expect(subjects[0]!.classSubjectId).toBe(targetOffering.id);

    const second = await commitPromotion(actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
      rows: [{ enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id }],
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toEqual([{ enrollmentId: sourceEnrollment.id, reason: "ALREADY_PROMOTED" }]);
  });

  it("blocks the whole commit when a target class has no offerings", async () => {
    await db.delete(classSubjects).where(eq(classSubjects.classId, targetClass.id));
    await expect(commitPromotion(actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
      rows: [{ enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id }],
    })).rejects.toMatchObject({ httpStatus: 409, code: "TARGET_CLASS_HAS_NO_OFFERINGS" });

    const old = one(await db.select().from(classEnrollments).where(eq(classEnrollments.id, sourceEnrollment.id)));
    expect(old.status).toBe("active");
    expect(await db.select().from(classEnrollments).where(eq(classEnrollments.sessionId, targetSession.id))).toHaveLength(0);
  });
});
