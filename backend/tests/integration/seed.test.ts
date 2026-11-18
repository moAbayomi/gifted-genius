import { describe, it, expect } from "vitest";
import { seed } from "../../src/db/seed.js";
import db from "../../src/db/client.js";
import {
  users,
  schools,
  roles,
  memberships,
  membershipRoles,
  auditLog,
  academicSessions,
  classes,
  terms,
} from "../../src/db/schema/index.js";
import { and, count, eq, sql } from "drizzle-orm";
import { one } from "../../src/shared/utils/assert.js";

async function counts() {
  const u = one(await db.select({ value: count() }).from(users));
  const s = one(await db.select({ value: count() }).from(schools));
  const r = one(await db.select({ value: count() }).from(roles));
  const m = one(await db.select({ value: count() }).from(memberships));
  const mr = one(await db.select({ value: count() }).from(membershipRoles));
  const as = one(await db.select({ value: count() }).from(academicSessions));
  const cls = one(await db.select({ value: count() }).from(classes));
  const t = one(await db.select({ value: count() }).from(terms));
  const a = one(await db.select({ value: count() }).from(auditLog));
  return {
    users: u.value,
    schools: s.value,
    roles: r.value,
    memberships: m.value,
    membershipRoles: mr.value,
    academicSessions: as.value,
    classes: cls.value,
    terms: t.value,
    audit: a.value,
  };
}

describe("seed", () => {
  it("is idempotent — second run produces identical state", async () => {
    const first = await seed({ password: "test-password-1234" });
    const countsA = await counts();

    const second = await seed({ password: "test-password-1234" });
    const countsB = await counts();

    // Counts identical (covers audit, sessions, terms, classes)
    expect(countsB).toEqual(countsA);

    // Same IDs across all entities
    expect(second.school.id).toBe(first.school.id);
    expect(second.owner.id).toBe(first.owner.id);
    expect(second.demoUsers.map((u) => u.id).sort()).toEqual(
      first.demoUsers.map((u) => u.id).sort(),
    );

    // Calendar entities keep the same IDs on the second run
    expect(second.academicSession.id).toBe(first.academicSession.id);
    expect(second.terms.map((t) => t.id).sort()).toEqual(
      first.terms.map((t) => t.id).sort(),
    );
    expect(second.demoClasses.map((c) => c.id).sort()).toEqual(
      first.demoClasses.map((c) => c.id).sort(),
    );
    expect(countsB.audit).toBe(countsA.audit);
  });

  it("creates the expected session, terms, and classes on first run", async () => {
    const before = await counts();
    const result = await seed({ password: "test-password-1234" });
    const after = await counts();

    // Session
    expect(after.academicSessions - before.academicSessions).toBe(1);
    expect(result.academicSession.label).toBe("2026/2027");
    expect(result.academicSession.closedAt).toBeNull();

    // Terms
    expect(after.terms - before.terms).toBe(3);
    expect(result.terms).toHaveLength(3);
    expect(result.terms.map((t) => t.number).sort()).toEqual([1, 2, 3]);

    // Exactly one active term, and it's Term 1
    const activeTerms = await db
      .select()
      .from(terms)
      .where(
        and(
          eq(terms.sessionId, result.academicSession.id),
          eq(terms.status, "active"),
        ),
      );
    expect(activeTerms).toHaveLength(1);
    expect(activeTerms[0]!.number).toBe(1);

    // Nine demo classes: JSS 1–3 A plus JSS 1 B and the SS tracks.
    expect(after.classes - before.classes).toBe(9);
    expect(result.demoClasses).toHaveLength(9);

    // Audit rows written on first run (proves the if (inserted) guards exist)
    expect(after.audit).toBeGreaterThan(before.audit);
  });

  it("creates one demo user per non-owner role", async () => {
    // Your existing test — unchanged
    const result = await seed({ password: "test-password-1234" });
    expect(result.demoUsers).toHaveLength(4);

    const student = result.demoUsers.find(
      (u) => u.firstName === "Demo" && u.lastName === "Student",
    );
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
