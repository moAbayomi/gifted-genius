import { performance } from "node:perf_hooks";
import { db } from "../db/client.js";
import {
  users,
  memberships,
  membershipRoles,
  academicSessions,
  classes,
  levels,
  subjects,
  classSubjects,
  studentProfiles,
  classEnrollments,
  type User,
} from "../db/schema/index.js";
import { createSchoolWithDefaults } from "../modules/schools/service.js";
import { hashPassword } from "../shared/utils/password.js";
import { getClassRoster } from "../modules/academics/enrollment/roster.js";
import { bulkEnroll } from "../modules/academics/enrollment/service.js";
import { rolloverSession } from "../modules/academics/rollover.js";
import type { Actor } from "../modules/rbac/can.js";
import { one } from "../shared/utils/assert.js";

const STUDENTS = 1500;
const CHUNK = 500;

async function main() {
  const owner = one(
    await db
      .insert(users)
      .values({
        email: `scale-owner-${crypto.randomUUID()}@test`,
        firstName: "Scale",
        lastName: "Owner",
      })
      .returning(),
  );
  const created = await createSchoolWithDefaults({
    name: "Scale School",
    slug: `scale-${crypto.randomUUID()}`,
    ownerUserId: owner.id,
  });
  const school = created.school;
  const studentRole = created.roles.find((r) => r.key === "student");
  if (!studentRole) throw new Error("student role missing");
  const actor: Actor = {
    userId: owner.id,
    membershipId: created.ownerMembership.id,
    schoolId: school.id,
    rank: 100,
    permissions: new Set([
      "structure:manage",
      "enrollments:manage",
      "enrollments:read",
    ]),
  };

  const level = one(
    await db
      .insert(levels)
      .values({ schoolId: school.id, name: "SCALE", sequence: 500, stage: "junior" })
      .returning(),
  );
  const sourceSession = one(
    await db
      .insert(academicSessions)
      .values({ schoolId: school.id, label: "2030/2031" })
      .returning(),
  );
  const bulkSession = one(
    await db
      .insert(academicSessions)
      .values({ schoolId: school.id, label: "2031/2032" })
      .returning(),
  );
  const rolloverTarget = one(
    await db
      .insert(academicSessions)
      .values({ schoolId: school.id, label: "2032/2033" })
      .returning(),
  );
  const sourceClass = one(
    await db
      .insert(classes)
      .values({
        schoolId: school.id,
        sessionId: sourceSession.id,
        levelId: level.id,
        armLabel: "SCALE-A",
        track: "general",
      })
      .returning(),
  );
  const bulkClass = one(
    await db
      .insert(classes)
      .values({
        schoolId: school.id,
        sessionId: bulkSession.id,
        levelId: level.id,
        armLabel: "SCALE-B",
        track: "general",
      })
      .returning(),
  );
  const subject = one(
    await db
      .insert(subjects)
      .values({ schoolId: school.id, code: "SCALE-SUB", name: "Scale Subject" })
      .returning(),
  );
  await db.insert(classSubjects).values([
    {
      schoolId: school.id,
      classId: sourceClass.id,
      subjectId: subject.id,
      isCompulsory: true,
    },
    {
      schoolId: school.id,
      classId: bulkClass.id,
      subjectId: subject.id,
      isCompulsory: true,
    },
  ]);

  const passwordHash = await hashPassword("scale-password-1234");

  const tUsers = performance.now();
  const allUsers: User[] = [];
  for (let start = 0; start < STUDENTS; start += CHUNK) {
    const rows = await db
      .insert(users)
      .values(
        Array.from({ length: Math.min(CHUNK, STUDENTS - start) }, (_, i) => ({
          email: `scale-${start + i}-${crypto.randomUUID()}@test`,
          passwordHash,
          firstName: `Scale${start + i}`,
          lastName: "Student",
        })),
      )
      .returning();
    allUsers.push(...rows);
  }

  const membershipRows = await db
    .insert(memberships)
    .values(
      allUsers.map((u, i) => ({
        userId: u.id,
        schoolId: school.id,
        username: `scale-${i}-${crypto.randomUUID().slice(0, 8)}`,
      })),
    )
    .returning();

  await db.insert(membershipRoles).values(
    membershipRows.map((m) => ({
      membershipId: m.id,
      roleId: studentRole.id,
      schoolId: school.id,
    })),
  );

  const profiles = await db
    .insert(studentProfiles)
    .values(
      membershipRows.map((m, i) => ({
        schoolId: school.id,
        membershipId: m.id,
        admissionNumber: `SCALE-${String(i).padStart(4, "0")}`,
      })),
    )
    .returning();

  await db.insert(classEnrollments).values(
    profiles.map((p) => ({
      schoolId: school.id,
      studentId: p.id,
      classId: sourceClass.id,
      sessionId: sourceSession.id,
      startedAt: new Date(),
      status: "active" as const,
    })),
  );
  const tSetup = performance.now();

  const tRoster = performance.now();
  const roster = await getClassRoster(db, actor, {
    classId: sourceClass.id,
    limit: 100,
  });
  const tRosterDone = performance.now();

  const tBulk = performance.now();
  await bulkEnroll(actor, {
    classId: bulkClass.id,
    studentIds: profiles.map((p) => p.id),
  });
  const tBulkDone = performance.now();

  const tRollover = performance.now();
  const rollover = await db.transaction((tx) =>
    rolloverSession(tx, actor, {
      fromSessionId: sourceSession.id,
      toSessionId: rolloverTarget.id,
    }),
  );
  const tRolloverDone = performance.now();

  console.log(
    JSON.stringify(
      {
        students: STUDENTS,
        setupMs: Math.round(tSetup - tUsers),
        rosterPageSize: 100,
        rosterRows: roster.students.length,
        rosterMs: Math.round(tRosterDone - tRoster),
        bulkEnrollMs: Math.round(tBulkDone - tBulk),
        rolloverMs: Math.round(tRolloverDone - tRollover),
        rollover,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
