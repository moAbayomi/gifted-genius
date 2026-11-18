import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import {
  academicSessions,
  memberships,
  terms,
  users,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import {
  createAcademicSession,
  currentSession,
  parseSessionLabel,
  updateAcademicSession,
} from "../../../src/modules/academics/academic-sessions/service.js";
import { createSchoolWithDefaults } from "../../../src/modules/schools/service.js";
import type { Actor } from "../../../src/modules/rbac/can.js";

describe("academic sessions", () => {
  let actor: Actor;
  let schoolId: string;
  let sessionId: string;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    const seeded = await seed({ password: "test-password-1234" });
    schoolId = seeded.school.id;
    sessionId = seeded.academicSession.id;

    const owner = one(
      await db.select().from(users).where(eq(users.email, "owner@demo.test")),
    );
    const membership = one(
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, owner.id),
            eq(memberships.schoolId, schoolId),
          ),
        ),
    );
    actor = {
      userId: owner.id,
      membershipId: membership.id,
      schoolId,
      rank: 100,
      permissions: new Set(["calendar:manage", "academics:read"]),
    };
  });

  async function makeOtherSchool(slug: string) {
    const user = one(
      await db
        .insert(users)
        .values({
          email: `${slug}@test.local`,
          firstName: "Other",
          lastName: "Owner",
        })
        .returning(),
    );
    const created = await createSchoolWithDefaults({
      name: `School ${slug}`,
      slug,
      ownerUserId: user.id,
    });
    const otherActor: Actor = {
      userId: user.id,
      membershipId: created.ownerMembership.id,
      schoolId: created.school.id,
      rank: 100,
      permissions: new Set(["calendar:manage", "academics:read"]),
    };
    return { school: created.school, actor: otherActor };
  }

  it("validates the label's consecutive years", () => {
    expect(parseSessionLabel("2026/2027")).toEqual({
      startYear: 2026,
      endYear: 2027,
    });
    expect(() => parseSessionLabel("2026/2030")).toThrow(
      expect.objectContaining({ code: "INVALID_SESSION_LABEL" }),
    );
    expect(() => parseSessionLabel("2026-2027")).toThrow(
      expect.objectContaining({ code: "INVALID_SESSION_LABEL" }),
    );
  });

  it("creates a session and rejects a duplicate label", async () => {
    const created = await db.transaction((tx) =>
      createAcademicSession(tx, actor, "2027/2028"),
    );
    expect(created.label).toBe("2027/2028");

    await expect(
      db.transaction((tx) => createAcademicSession(tx, actor, "2027/2028")),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LABEL_TAKEN" });
  });

  it("allows the same label at another school", async () => {
    const other = await makeOtherSchool("other-school");
    const created = await db.transaction((tx) =>
      createAcademicSession(tx, other.actor, "2026/2027"),
    );
    expect(created.schoolId).toBe(other.school.id);
  });

  it("rejects an invalid label before writing", async () => {
    await expect(
      db.transaction((tx) => createAcademicSession(tx, actor, "2026/2030")),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_SESSION_LABEL" });
  });

  it("updates a label and rejects duplicates/cross-school IDs", async () => {
    const created = await db.transaction((tx) =>
      createAcademicSession(tx, actor, "2027/2028"),
    );
    const updated = await db.transaction((tx) =>
      updateAcademicSession(tx, actor, created.id, "2028/2029"),
    );
    expect(updated.label).toBe("2028/2029");

    await expect(
      db.transaction((tx) =>
        updateAcademicSession(tx, actor, created.id, "2026/2027"),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LABEL_TAKEN" });

    const other = await makeOtherSchool("other-school");
    await expect(
      db.transaction((tx) =>
        updateAcademicSession(tx, other.actor, created.id, "2027/2028"),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  it("returns the active term's session", async () => {
    const current = await currentSession(db, actor);
    expect(current?.id).toBe(sessionId);
  });

  it("falls back to the latest session by label when none is active", async () => {
    await db
      .update(terms)
      .set({ status: "closed" })
      .where(and(eq(terms.schoolId, schoolId), eq(terms.status, "active")));

    const latest = one(
      await db
        .insert(academicSessions)
        .values({ schoolId, label: "2027/2028", closedAt: new Date() })
        .returning(),
    );

    const current = await currentSession(db, actor);
    expect(current?.id).toBe(latest.id);
  });

  it("returns null when the school has no session", async () => {
    const other = await makeOtherSchool("empty-school");
    const current = await currentSession(db, other.actor);
    expect(current).toBeNull();
  });
});
