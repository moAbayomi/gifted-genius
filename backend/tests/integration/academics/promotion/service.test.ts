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


  it("blocks a locked target session", async () => {
    await db.update(academicSessions).set({ closedAt: new Date() }).where(eq(academicSessions.id, targetSession.id));
    await expect(commitPromotion(actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
      rows: [{ enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id }],
    })).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("blocks an earlier target session", async () => {
    const earlier = one(await db.insert(academicSessions).values({ schoolId: school.id, label: "2025/2026" }).returning());
    await expect(commitPromotion(actor, {
      sourceSessionId: sourceSession.id, targetSessionId: earlier.id,
      rows: [{ enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id }],
    })).rejects.toMatchObject({ httpStatus: 400, code: "TARGET_SESSION_NOT_LATER" });
  });

  it("rejects duplicate rows before writing anything", async () => {
    await expect(commitPromotion(actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
      rows: [
        { enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id },
        { enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id },
      ],
    })).rejects.toMatchObject({ httpStatus: 400, code: "DUPLICATE_ENROLLMENT" });
    const old = one(await db.select().from(classEnrollments).where(eq(classEnrollments.id, sourceEnrollment.id)));
    expect(old.status).toBe("active");
  });

  it("graduates without creating a target enrolment", async () => {
    const ss3 = one(await db.select().from(levels).where(and(eq(levels.schoolId, school.id), eq(levels.name, "SS 3"))));
    const gradClass = one(await db.insert(classes).values({
      schoolId: school.id, sessionId: sourceSession.id, levelId: ss3.id, armLabel: "A", track: "science",
    }).returning());
    const user = one(await db.insert(users).values({ email: `grad-${crypto.randomUUID()}@test`, firstName: "Grad", lastName: "Student" }).returning());
    const membership = one(await db.insert(memberships).values({ userId: user.id, schoolId: school.id }).returning());
    const profile = one(await db.insert(studentProfiles).values({
      schoolId: school.id, membershipId: membership.id, admissionNumber: `G-${crypto.randomUUID().slice(0, 8)}`,
    }).returning());
    const gradEnrollment = one(await db.insert(classEnrollments).values({
      schoolId: school.id, studentId: profile.id, classId: gradClass.id,
      sessionId: sourceSession.id, startedAt: new Date(), status: "active",
    }).returning());

    const result = await commitPromotion(actor, {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
      rows: [{ enrollmentId: gradEnrollment.id, targetClassId: null }],
    });
    expect(result.created).toBe(0);
    expect(result.sourceEnded).toBe(1);
    expect(await db.select().from(classEnrollments).where(eq(classEnrollments.sessionId, targetSession.id))).toHaveLength(0);
  });

  it("two concurrent commits do not create duplicates", async () => {
    const input = {
      sourceSessionId: sourceSession.id, targetSessionId: targetSession.id,
      rows: [{ enrollmentId: sourceEnrollment.id, targetClassId: targetClass.id }],
    };
    const results = await Promise.allSettled([commitPromotion(actor, input), commitPromotion(actor, input)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const totalCreated = fulfilled.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.created : 0), 0);
    expect(totalCreated).toBe(1);
    expect(await db.select().from(classEnrollments).where(eq(classEnrollments.sessionId, targetSession.id))).toHaveLength(1);
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
