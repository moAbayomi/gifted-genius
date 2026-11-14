import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  users, memberships, membershipRoles, academicSessions, classes, levels,
  subjects, classSubjects, studentProfiles, classEnrollments,
} from "../db/schema/index.js";
import { createSchoolWithDefaults } from "../modules/schools/service.js";
import { hashPassword } from "../shared/utils/password.js";
import { getClassRoster } from "../modules/academics/enrollment/roster.js";
import { bulkEnroll } from "../modules/academics/enrollment/service.js";
import { rolloverSession } from "../modules/academics/rollover.js";
import { commitPromotion } from "../modules/academics/promotion/service.js";
import type { Actor } from "../modules/rbac/can.js";
import { one } from "../shared/utils/assert.js";

const STUDENTS = 1500;
const CLASSES = 40;
const OFFERINGS = 12;

async function main() {
  const owner = one(await db.insert(users).values({
    email: `scale-${crypto.randomUUID()}@test`, firstName: "Scale", lastName: "Owner",
  }).returning());
  const created = await createSchoolWithDefaults({
    name: "Scale School", slug: `scale-${crypto.randomUUID()}`, ownerUserId: owner.id,
  });
  const school = created.school;
  const studentRole = created.roles.find((r) => r.key === "student")!;
  const actor: Actor = {
    userId: owner.id, membershipId: created.ownerMembership.id, schoolId: school.id,
    rank: 100, permissions: new Set(["structure:manage", "enrollments:manage", "enrollments:read", "enrollments:read_all"]),
  };
  const level = one(await db.insert(levels).values({
    schoolId: school.id, name: "SCALE", sequence: 500, stage: "junior",
  }).returning());
  const sourceSession = one(await db.insert(academicSessions).values({ schoolId: school.id, label: "2030/2031" }).returning());
  const bulkSession = one(await db.insert(academicSessions).values({ schoolId: school.id, label: "2031/2032" }).returning());
  const rolloverSessionTarget = one(await db.insert(academicSessions).values({ schoolId: school.id, label: "2032/2033" }).returning());
  const promotionSession = one(await db.insert(academicSessions).values({ schoolId: school.id, label: "2033/2034" }).returning());
  const promotionLevel = one(await db.insert(levels).values({
    schoolId: school.id, name: "SCALE NEXT", sequence: 501, stage: "junior",
  }).returning());

  const t0 = performance.now();
  const passwordHash = await hashPassword("scale-password-1234");
  const userRows: { id: string }[] = [];
  for (let i = 0; i < STUDENTS; i += 500) {
    const rows = await db.insert(users).values(Array.from({ length: Math.min(500, STUDENTS - i) }, (_, j) => ({
      email: `scale-${i + j}-${crypto.randomUUID()}@test`, passwordHash, firstName: `S${i + j}`, lastName: "Scale",
    }))).returning({ id: users.id });
    userRows.push(...rows);
  }
  const membershipRows = await db.insert(memberships).values(userRows.map((u, i) => ({
    userId: u.id, schoolId: school.id, username: `scale-${i}-${crypto.randomUUID().slice(0, 8)}`,
  }))).returning({ id: memberships.id });
  await db.insert(membershipRoles).values(membershipRows.map((m) => ({
    membershipId: m.id, roleId: studentRole.id, schoolId: school.id,
  })));
  const profiles = await db.insert(studentProfiles).values(membershipRows.map((m, i) => ({
    schoolId: school.id, membershipId: m.id, admissionNumber: `SCALE-${String(i).padStart(4, "0")}`,
  }))).returning({ id: studentProfiles.id });

  const subjectsRows = await db.insert(subjects).values(Array.from({ length: OFFERINGS }, (_, i) => ({
    schoolId: school.id, code: `SCALE-${i}`, name: `Scale Subject ${i}`,
  }))).returning({ id: subjects.id });

  const sourceClasses = await db.insert(classes).values(Array.from({ length: CLASSES }, (_, i) => ({
    schoolId: school.id, sessionId: sourceSession.id, levelId: level.id, armLabel: `A${i}`, track: "general" as const,
  }))).returning({ id: classes.id });
  const bulkClasses = await db.insert(classes).values(Array.from({ length: CLASSES }, (_, i) => ({
    schoolId: school.id, sessionId: bulkSession.id, levelId: level.id, armLabel: `A${i}`, track: "general" as const,
  }))).returning({ id: classes.id });

  await db.insert(classSubjects).values(sourceClasses.flatMap((c) => subjectsRows.map((s) => ({
    schoolId: school.id, classId: c.id, subjectId: s.id, isCompulsory: true, electiveGroupId: null,
  }))));
  await db.insert(classSubjects).values(bulkClasses.flatMap((c) => subjectsRows.map((s) => ({
    schoolId: school.id, classId: c.id, subjectId: s.id, isCompulsory: true, electiveGroupId: null,
  }))));

  const enrollmentRows = profiles.map((p, i) => ({
    schoolId: school.id, studentId: p.id, classId: sourceClasses[i % CLASSES]!.id,
    sessionId: sourceSession.id, startedAt: new Date(), status: "active" as const,
  }));
  await db.insert(classEnrollments).values(enrollmentRows);

  const promotionClasses = await db.insert(classes).values(Array.from({ length: CLASSES }, (_, i) => ({
    schoolId: school.id, sessionId: promotionSession.id, levelId: promotionLevel.id,
    armLabel: `A${i}`, track: "general" as const,
  }))).returning({ id: classes.id });
  await db.insert(classSubjects).values(promotionClasses.flatMap((c) => subjectsRows.map((s) => ({
    schoolId: school.id, classId: c.id, subjectId: s.id,
    isCompulsory: true, electiveGroupId: null,
  }))));
  // enrollmentRows were inserted without returning ids; reload them.
  const sourceEnrollments = await db.select({ id: classEnrollments.id, studentId: classEnrollments.studentId })
    .from(classEnrollments).where(eq(classEnrollments.sessionId, sourceSession.id));
  const sourceByStudent = new Map(sourceEnrollments.map((e) => [e.studentId, e.id]));
  const promotionPlan = profiles.map((p, i) => ({
    enrollmentId: sourceByStudent.get(p.id)!,
    targetClassId: promotionClasses[i % CLASSES]!.id,
  }));
  const setupMs = performance.now() - t0;

  const rosterStart = performance.now();
  const roster = await getClassRoster(db, actor, { classId: sourceClasses[0]!.id, limit: 40 });
  const rosterMs = performance.now() - rosterStart;

  const bulkStart = performance.now();
  const grouped = new Map<number, string[]>();
  profiles.forEach((p, i) => {
    const idx = i % CLASSES;
    const list = grouped.get(idx) ?? [];
    list.push(p.id);
    grouped.set(idx, list);
  });
  for (const [idx, ids] of grouped) {
    await bulkEnroll(actor, { classId: bulkClasses[idx]!.id, studentIds: ids });
  }
  const bulkMs = performance.now() - bulkStart;

  const rolloverStart = performance.now();
  const rollover = await db.transaction((tx) => rolloverSession(tx, actor, {
    fromSessionId: sourceSession.id, toSessionId: rolloverSessionTarget.id,
  }));
  const rolloverMs = performance.now() - rolloverStart;

  const promotionStart = performance.now();
  const promotion = await commitPromotion(actor, {
    sourceSessionId: sourceSession.id,
    targetSessionId: promotionSession.id,
    rows: promotionPlan,
  });
  const promotionMs = performance.now() - promotionStart;

  console.log(JSON.stringify({
    students: STUDENTS, classes: CLASSES, offeringsPerClass: OFFERINGS,
    setupMs: Math.round(setupMs), rosterRows: roster.students.length,
    rosterMs: Math.round(rosterMs), wholeSchoolEnrollMs: Math.round(bulkMs),
    rolloverMs: Math.round(rolloverMs), rollover,
    promotionMs: Math.round(promotionMs), promotion,
  }, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
