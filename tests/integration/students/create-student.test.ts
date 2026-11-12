import { describe, it, expect, beforeEach } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import {
  users,
  memberships,
  membershipRoles,
  roles,
  studentProfiles,
  type School,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { createSchoolWithDefaults } from "../../../src/modules/schools/service.js";
import { createStudent } from "../../../src/modules/students/service.js";
import { createStudentSchema } from "../../../src/modules/students/schema.js";
import { hashPassword } from "../../../src/shared/utils/password.js";
import { PERMISSIONS } from "../../../src/modules/rbac/permissions.js";
import type { Actor } from "../../../src/modules/rbac/can.js";

let school: School;
let actor: Actor;

async function credentials() {
  const temporaryPassword = "temp-pass-1234";
  return { temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
}

async function profileCount(): Promise<number> {
  const row = one(
    await db.select({ n: count() }).from(studentProfiles),
  );
  return row.n;
}

describe("createStudent", () => {
  beforeEach(async () => {
    const ownerUser = one(
      await db
        .insert(users)
        .values({
          email: `owner-${crypto.randomUUID()}@test`,
          firstName: "Owner",
          lastName: "Test",
        })
        .returning(),
    );

    const created = await createSchoolWithDefaults({
      name: "Students School",
      slug: `students-${crypto.randomUUID()}`,
      ownerUserId: ownerUser.id,
    });
    school = created.school;
    const ownerRole = created.roles.find((r) => r.key === "owner");
    if (!ownerRole) throw new Error("owner role missing");

    actor = {
      userId: ownerUser.id,
      membershipId: created.ownerMembership.id,
      schoolId: school.id,
      rank: ownerRole.rank,
      permissions: new Set(PERMISSIONS),
    };
  });

  it("creates a user, membership, student role, and profile in one flow", async () => {
    const creds = await credentials();
    const result = await db.transaction((tx) =>
      createStudent(
        tx,
        actor,
        {
          firstName: "Ada",
          lastName: "Okafor",
          email: "ada@test.local",
          admissionNumber: "ADM-001",
          house: "Blue",
        },
        creds,
      ),
    );

    expect(result.member.roleKeys).toEqual(["student"]);
    expect(result.member.username).toBeNull();
    expect(result.student.admissionNumber).toBe("ADM-001");
    expect(result.student.house).toBe("Blue");
    expect(result.temporaryPassword).toBe(creds.temporaryPassword);

    const user = one(
      await db.select().from(users).where(eq(users.email, "ada@test.local")),
    );
    expect(user.mustChangePassword).toBe(true);

    const membership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, result.membershipId)),
    );
    expect(membership.schoolId).toBe(school.id);

    const assignedRoles = await db
      .select({ key: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, result.membershipId));
    expect(assignedRoles.map((r) => r.key)).toEqual(["student"]);
  });

  it("creates a username-only student when no email is supplied", async () => {
    const creds = await credentials();
    const result = await db.transaction((tx) =>
      createStudent(
        tx,
        actor,
        {
          firstName: "No",
          lastName: "Email",
          username: "no-email-student",
          admissionNumber: "ADM-002",
        },
        creds,
      ),
    );

    expect(result.member.email).toBeNull();
    expect(result.member.username).toBe("no-email-student");
    expect(result.member.roleKeys).toEqual(["student"]);
    expect(result.temporaryPassword).toBeDefined();
  });

  it("schema rejects a student with neither email nor username", () => {
    const parsed = createStudentSchema.safeParse({
      firstName: "No",
      lastName: "Login",
      admissionNumber: "ADM-003",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes("username"))).toBe(true);
    }
  });

  it("service also rejects direct calls with neither email nor username", async () => {
    const creds = await credentials();
    await expect(
      db.transaction((tx) =>
        createStudent(
          tx,
          actor,
          {
            firstName: "No",
            lastName: "Login",
            admissionNumber: "ADM-003",
          } as never,
          creds,
        ),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "VALIDATION_ERROR" });
  });

  it("duplicate admission rolls back the user, membership, roles, and profile", async () => {
    const first = await credentials();
    await db.transaction((tx) =>
      createStudent(
        tx,
        actor,
        {
          firstName: "First",
          lastName: "Student",
          email: "first-student@test.local",
          admissionNumber: "ADM-DUP",
        },
        first,
      ),
    );

    const second = await credentials();
    await expect(
      db.transaction((tx) =>
        createStudent(
          tx,
          actor,
          {
            firstName: "Second",
            lastName: "Student",
            email: "second-student@test.local",
            username: "second-student",
            admissionNumber: "ADM-DUP",
          },
          second,
        ),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "ADMISSION_NUMBER_TAKEN",
    });

    const orphanUser = await db
      .select()
      .from(users)
      .where(eq(users.email, "second-student@test.local"));
    expect(orphanUser).toHaveLength(0);

    const orphanMembership = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.schoolId, school.id),
          eq(memberships.username, "second-student"),
        ),
      );
    expect(orphanMembership).toHaveLength(0);
    expect(await profileCount()).toBe(1);
  });
});
