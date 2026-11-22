import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  users,
  memberships,
  studentProfiles,
  academicSessions,
  levels,
  classes,
  subjects,
  classSubjects,
  classEnrollments,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { createSchoolWithDefaults } from "../../../../src/modules/schools/service.js";
import {
  saveImport,
  validateImport,
} from "../../../../src/modules/academics/student-import/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

let schoolId: string;
let formClassId: string;
let otherClassId: string;
let teacher: Actor;

const row = (n: number) => ({
  firstName: `Ada${n}`,
  lastName: `Okafor${n}`,
});

describe("class-scoped student import", () => {
  beforeEach(async () => {
    const owner = one(await db.insert(users).values({
      email: `class-import-owner-${crypto.randomUUID()}@test`,
      firstName: "Import",
      lastName: "Owner",
    }).returning());
    const created = await createSchoolWithDefaults({
      name: "Class Import School",
      slug: `class-imp-${crypto.randomUUID()}`,
      ownerUserId: owner.id,
    });
    schoolId = created.school.id;

    const teacherUser = one(await db.insert(users).values({
      email: `form-teacher-${crypto.randomUUID()}@test`,
      firstName: "Form",
      lastName: "Teacher",
    }).returning());
    const teacherMembership = one(await db.insert(memberships).values({
      userId: teacherUser.id,
      schoolId,
      status: "active",
    }).returning());
    teacher = {
      userId: teacherUser.id,
      membershipId: teacherMembership.id,
      schoolId,
      rank: 50,
      permissions: new Set([
        "school:read",
        "academics:read",
        "enrollments:read",
        "students:import",
      ]),
    };

    const session = one(await db.insert(academicSessions).values({
      schoolId,
      label: "2026/2027",
    }).returning());
    const jss1 = one(await db.select().from(levels).where(and(
      eq(levels.schoolId, schoolId),
      eq(levels.name, "JSS 1"),
    )));
    formClassId = one(await db.insert(classes).values({
      schoolId,
      sessionId: session.id,
      levelId: jss1.id,
      armLabel: "A",
      track: "general",
      formTeacherMembershipId: teacherMembership.id,
    }).returning()).id;
    otherClassId = one(await db.insert(classes).values({
      schoolId,
      sessionId: session.id,
      levelId: jss1.id,
      armLabel: "B",
      track: "general",
    }).returning()).id;

    const subject = one(await db.insert(subjects).values({
      schoolId,
      code: "ENG",
      name: "English",
    }).returning());
    await db.insert(classSubjects).values({
      schoolId,
      classId: formClassId,
      subjectId: subject.id,
      isCompulsory: true,
    });
  });

  it("validates rows without className against the fixed class", async () => {
    const result = await validateImport(db, teacher, [row(1), row(2)], {
      fixedClassId: formClassId,
    });
    expect(result.valid).toBe(true);
    expect(result.classByRow.get(1)).toBe(formClassId);
    expect(result.classByRow.get(2)).toBe(formClassId);
  });

  it("refuses a class the teacher does not form-teach", async () => {
    await expect(
      validateImport(db, teacher, [row(1)], { fixedClassId: otherClassId }),
    ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
  });

  it("creates generated admission numbers/usernames and an enrolment", async () => {
    const result = await saveImport(teacher, [row(1)], {
      fixedClassId: formClassId,
    });

    expect(result.valid).toBe(true);
    expect(result.created).toBe(1);
    expect(result.credentials).toHaveLength(1);
    const credential = result.credentials[0]!;
    expect(credential.admissionNumber).toMatch(/^ADM\/\d{4}\/\d{4}$/);
    expect(credential.username).toBe("ada1.okafor1");
    expect(credential.temporaryPassword.length).toBeGreaterThan(8);

    const profile = one(await db
      .select()
      .from(studentProfiles)
      .where(eq(studentProfiles.id, credential.studentId)));
    expect(profile.admissionNumber).toBe(credential.admissionNumber);

    const membership = one(await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, credential.membershipId)));
    expect(membership.username).toBe(credential.username);

    const enrollment = one(await db
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.studentId, credential.studentId)));
    expect(enrollment.classId).toBe(formClassId);
  });
});
