import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import { seed } from "../../../../src/db/seed.js";
import {
  academicSessions,
  auditLog,
  memberships,
  schools,
  terms,
  users,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  createTerm,
  updateTerm,
} from "../../../../src/modules/academics/calendar/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

describe("term writes", () => {
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

  const validTerm = (overrides: Record<string, unknown> = {}) => ({
    sessionId,
    number: 4,
    name: "Fourth Term",
    startDate: "2027-09-15",
    endDate: "2027-12-18",
    ...overrides,
  });

  it("creates a term inside an open session and audits it", async () => {
    const created = await db.transaction((tx) =>
      createTerm(tx, actor, validTerm() as never),
    );

    expect(created).toMatchObject({
      sessionId,
      number: 4,
      name: "Fourth Term",
      status: "planned",
    });

    const audit = one(
      await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, "term.created"),
            eq(auditLog.targetId, created.id),
          ),
        ),
    );
    expect(audit.targetId).toBe(created.id);
  });

  it("refuses overlapping dates and duplicate numbers", async () => {
    await expect(
      db.transaction((tx) =>
        createTerm(
          tx,
          actor,
          validTerm({ startDate: "2026-10-01", endDate: "2026-11-01" }) as never,
        ),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "TERM_DATES_OVERLAP" });

    await expect(
      db.transaction((tx) =>
        createTerm(tx, actor, validTerm({ number: 1 }) as never),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "TERM_NUMBER_TAKEN" });
  });

  it("rejects reversed dates before writing", async () => {
    await expect(
      db.transaction((tx) =>
        createTerm(
          tx,
          actor,
          validTerm({ startDate: "2027-12-18", endDate: "2027-09-15" }) as never,
        ),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_DATES" });
  });

  it("rejects impossible calendar dates", async () => {
    await expect(
      db.transaction((tx) =>
        createTerm(
          tx,
          actor,
          validTerm({ startDate: "2026-02-30", endDate: "2026-03-10" }) as never,
        ),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_DATES" });
  });

  it("updates a term and refuses an overlapping edit", async () => {
    const term2 = one(
      await db
        .select()
        .from(terms)
        .where(and(eq(terms.sessionId, sessionId), eq(terms.number, 2))),
    );

    const renamed = await db.transaction((tx) =>
      updateTerm(tx, actor, term2.id, { name: "  Second Term A  " }),
    );
    expect(renamed.name).toBe("Second Term A");

    await expect(
      db.transaction((tx) =>
        updateTerm(tx, actor, term2.id, {
          startDate: "2026-10-01",
          endDate: "2026-11-01",
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "TERM_DATES_OVERLAP" });
  });

  it("refuses writes in a locked session", async () => {
    const locked = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId,
          label: "2028/2029",
          closedAt: new Date(),
        })
        .returning(),
    );

    await expect(
      db.transaction((tx) =>
        createTerm(tx, actor, validTerm({ sessionId: locked.id }) as never),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("404s for another school's session", async () => {
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "Other", slug: "other" })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: otherSchool.id, label: "2026/2027" })
        .returning(),
    );

    await expect(
      db.transaction((tx) =>
        createTerm(tx, actor, validTerm({ sessionId: otherSession.id }) as never),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  it("serializes concurrent overlapping creates: one wins, one 409s", async () => {
    const results = await Promise.allSettled([
      db.transaction((tx) => createTerm(tx, actor, validTerm({ number: 4 }) as never)),
      db.transaction((tx) => createTerm(tx, actor, validTerm({ number: 5 }) as never)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ httpStatus: 409, code: "TERM_DATES_OVERLAP" });
  });
});
