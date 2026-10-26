import { describe, it, expect } from "vitest";
import { seed } from "../../src/db/seed.js";
import db from "../../src/db/client.js";
import {
  users, schools, roles, memberships, membershipRoles, auditLog,
} from "../../src/db/schema/index.js";
import { count, sql } from "drizzle-orm";
import { one } from "../../src/shared/utils/assert.js";

async function counts() {
  const u = one(await db.select({ value: count() }).from(users));
  const s = one(await db.select({ value: count() }).from(schools));
  const r = one(await db.select({ value: count() }).from(roles));
  const m = one(await db.select({ value: count() }).from(memberships));
  const mr = one(await db.select({ value: count() }).from(membershipRoles));
  const a = one(await db.select({ value: count() }).from(auditLog));
  return {
    users: u.value,
    schools: s.value,
    roles: r.value,
    memberships: m.value,
    membershipRoles: mr.value,
    audit: a.value,
  };
}

describe("seed", () => {
  it("is idempotent — second run produces identical state", async () => {
    const first = await seed({ password: "test-password-1234" });
    const countsA = await counts();

    const second = await seed({ password: "test-password-1234" });
    const countsB = await counts();

    expect(countsB).toEqual(countsA);
    expect(second.school.id).toBe(first.school.id);
    expect(second.owner.id).toBe(first.owner.id);
    expect(second.demoUsers.map((u) => u.id).sort()).toEqual(
      first.demoUsers.map((u) => u.id).sort(),
    );
  });

  it("creates one demo user per non-owner role", async () => {
    const result = await seed({ password: "test-password-1234" });

    expect(result.demoUsers).toHaveLength(4); // principal, teacher, guardian, student

    // Check the student has no email but has a membership with username
    const student = result.demoUsers.find((u) => u.firstName === "Demo" && u.lastName === "Student");
    expect(student).toBeDefined();
    expect(student!.email).toBeNull();

    const studentMembership = one(
      await db
        .select()
        .from(memberships)
        .where(sql`${memberships.userId} = ${student!.id}`),
    );
    expect(studentMembership.username).toBe("jss1-2026-001");
  });
});