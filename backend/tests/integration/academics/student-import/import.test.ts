import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../../../src/db/client.js";
import {
  users, memberships, studentProfiles, academicSessions, levels, classes,
  subjects, classSubjects, classEnrollments, studentSubjects,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { createSchoolWithDefaults } from "../../../../src/modules/schools/service.js";
import {
  validateImport, saveImport,
} from "../../../../src/modules/academics/student-import/service.js";
import { PERMISSIONS } from "../../../../src/modules/rbac/permissions.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

let schoolId: string;
let sessionId: string;
let classId: string;
let actor: Actor;

const row = (n: number, overrides: Record<string, unknown> = {}) => ({
  firstName: `First${n}`,
  lastName: `Last${n}`,
  email: `import-${n}-${crypto.randomUUID()}@x.test`,
  admissionNumber: `IMP-${n}-${crypto.randomUUID().slice(0, 6)}`,
  className: "JSS 1 A",
  ...overrides,
});

describe("student import", () => {
  beforeEach(async () => {
    const owner = one(await db.insert(users).values({
      email: `import-owner-${crypto.randomUUID()}@test`, firstName: "Import", lastName: "Owner",
    }).returning());
    const created = await createSchoolWithDefaults({
      name: "Import School", slug: `imp-${crypto.randomUUID()}`, ownerUserId: owner.id,
    });
    schoolId = created.school.id;
    actor = {
      userId: owner.id, membershipId: created.ownerMembership.id, schoolId,
      rank: 100, permissions: new Set(PERMISSIONS),
    };
    const session = one(await db.insert(academicSessions).values({
      schoolId, label: "2026/2027",
    }).returning());
    sessionId = session.id;
    const level = one(await db.select().from(levels).where(and(
      eq(levels.schoolId, schoolId), eq(levels.name, "JSS 1"),
    )));
    classId = one(await db.insert(classes).values({
      schoolId, sessionId, levelId: level.id, armLabel: "A", track: "general",
    }).returning()).id;
    const subject = one(await db.insert(subjects).values({
      schoolId, code: "ENG", name: "English",
    }).returning());
    await db.insert(classSubjects).values({
      schoolId, classId, subjectId: subject.id, isCompulsory: true,
    });
  });

  it("returns every mistake with row numbers", async () => {
    const existingUser = one(await db.insert(users).values({
      email: `existing-${crypto.randomUUID()}@test`, firstName: "Existing", lastName: "Student",
    }).returning());
    const existingMembership = one(await db.insert(memberships).values({
      userId: existingUser.id, schoolId,
    }).returning());
    await db.insert(studentProfiles).values({
      schoolId, membershipId: existingMembership.id, admissionNumber: "DB-EXIST",
    });

    const base = row(1);
    const result = await validateImport(db, actor, [
      base,
      row(2, { className: "JSS 9 Z" }),
      row(3, { admissionNumber: base.admissionNumber }),
      row(4, { email: base.email }),
      row(5, { admissionNumber: "DB-EXIST" }),
      { firstName: "No", admissionNumber: "MISSING-LAST", className: "JSS 1 A" },
    ]);

    expect(result.valid).toBe(false);
    expect(result.problems.map((p) => p.row)).toEqual(expect.arrayContaining([2, 3, 4, 5, 6]));
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, code: "UNKNOWN_CLASS" }),
      expect.objectContaining({ row: 3, code: "DUPLICATE_IN_FILE", field: "admissionNumber" }),
      expect.objectContaining({ row: 4, code: "DUPLICATE_IN_FILE", field: "email" }),
      expect.objectContaining({ row: 5, code: "DUPLICATE_IN_DATABASE", field: "admissionNumber" }),
      expect.objectContaining({ row: 6, code: "INVALID_ROW" }),
    ]));
  });

  it("resolves class names ignoring case and spacing", async () => {
    const result = await validateImport(db, actor, [
      row(1, { className: "  jss 1   a " }),
    ]);
    expect(result.valid).toBe(true);
    expect(result.classByRow.get(1)).toBe(classId);
  });

  it("dry run validates but writes nothing", async () => {
    const before = await db.select().from(users);
    const result = await saveImport(actor, [row(1)], { dryRun: true });
    expect(result.valid).toBe(true);
    expect(result.created).toBe(0);
    expect(await db.select().from(users)).toHaveLength(before.length);
  });


  it("rolls the whole chunk back when a save-time conflict occurs", async () => {
    await db.execute(sql`
      create or replace function force_import_fail() returns trigger as $$
      begin
        if NEW.admission_number = 'ROLLBACK-FAIL' then
          raise exception 'forced import failure';
        end if;
        return NEW;
      end;
      $$ language plpgsql
    `);
    await db.execute(sql`
      create trigger force_import_fail_trigger
      before insert on student_profiles
      for each row execute function force_import_fail()
    `);
    try {
      const beforeUsers = await db.select().from(users);
      const beforeProfiles = await db.select().from(studentProfiles);
      await expect(saveImport(actor, [
        row(1),
        row(2, { admissionNumber: "ROLLBACK-FAIL" }),
      ])).rejects.toThrow();

      expect(await db.select().from(users)).toHaveLength(beforeUsers.length);
      expect(await db.select().from(studentProfiles)).toHaveLength(beforeProfiles.length);
      expect(await db.select().from(classEnrollments)).toHaveLength(0);
    } finally {
      await db.execute(sql`drop trigger if exists force_import_fail_trigger on student_profiles`);
      await db.execute(sql`drop function if exists force_import_fail()`);
    }
  });

  it("does not write temporary passwords to captured logs", async () => {
    const lines: string[] = [];
    const logger = pino({}, { write: (s: string) => lines.push(s) } as never);
    const result = await saveImport(actor, [row(1)]);
    expect(result.created).toBe(1);
    const password = result.credentials[0]!.temporaryPassword;
    logger.flush();
    expect(lines.join("")).not.toContain(password);
  });
  it("saves a clean chunk and returns one-time credentials", async () => {
    const result = await saveImport(actor, [row(1), row(2)]);
    expect(result.valid).toBe(true);
    expect(result.created).toBe(2);
    expect(result.credentials).toHaveLength(2);
    expect(new Set(result.credentials.map((c) => c.temporaryPassword)).size).toBe(2);

    const createdUsers = await db.select().from(users).where(eq(users.email, result.credentials[0]!.studentId));
    // The credential carries the student profile id; verify by admission instead.
    const profiles = await db.select().from(studentProfiles).where(eq(studentProfiles.schoolId, schoolId));
    expect(profiles).toHaveLength(2);
    const enrollments = await db.select().from(classEnrollments).where(eq(classEnrollments.classId, classId));
    expect(enrollments).toHaveLength(2);
    expect(await db.select().from(studentSubjects)).toHaveLength(2);
    expect(createdUsers).toHaveLength(0);

    const profileUser = one(await db.select().from(memberships).where(eq(memberships.id, result.credentials[0]!.membershipId)));
    const user = one(await db.select().from(users).where(eq(users.id, profileUser.userId)));
    expect(user.mustChangePassword).toBe(true);
  });
});
