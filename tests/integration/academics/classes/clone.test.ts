import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import { seed } from "../../../../src/db/seed.js";
import {
  academicSessions,
  auditLog,
  classes,
  levels,
  memberships,
  schools,
  users,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  archiveClass,
  cloneClasses,
} from "../../../../src/modules/academics/classes/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

describe("class cloning", () => {
  let actor: Actor;
  let schoolId: string;
  let sourceSessionId: string;
  let sourceClassCount: number;
  let sourceClasses: (typeof classes.$inferSelect)[];

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    const seeded = await seed({ password: "test-password-1234" });
    schoolId = seeded.school.id;
    sourceSessionId = seeded.academicSession.id;
    sourceClasses = seeded.demoClasses;
    sourceClassCount = sourceClasses.length;

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
      permissions: new Set(["structure:manage", "academics:read"]),
    };
  });

  async function makeTarget(label = "2027/2028") {
    return one(
      await db
        .insert(academicSessions)
        .values({ schoolId, label })
        .returning(),
    );
  }

  it("clones every live class at the same level, arm and track", async () => {
    const target = await makeTarget();

    const result = await db.transaction((tx) =>
      cloneClasses(tx, actor, {
        fromSessionId: sourceSessionId,
        toSessionId: target.id,
      }),
    );
    const cloned = result.cloned;

    expect(cloned).toHaveLength(sourceClassCount);
    expect(
      cloned.map((c) => `${c.levelId}:${c.armLabel}:${c.track}`).sort(),
    ).toEqual(
      sourceClasses.map((c) => `${c.levelId}:${c.armLabel}:${c.track}`).sort(),
    );

    const targetRows = await db
      .select()
      .from(classes)
      .where(eq(classes.sessionId, target.id));
    expect(targetRows).toHaveLength(sourceClassCount);

    const clonedAudits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "class.cloned"));
    expect(clonedAudits).toHaveLength(sourceClassCount);
  });

  it("does not clone archived classes", async () => {
    const target = await makeTarget();
    const archivedSource = sourceClasses[0]!;
    await db.transaction((tx) =>
      archiveClass(tx, actor, archivedSource.id),
    );

    const result = await db.transaction((tx) =>
      cloneClasses(tx, actor, {
        fromSessionId: sourceSessionId,
        toSessionId: target.id,
      }),
    );
    const cloned = result.cloned;

    expect(cloned).toHaveLength(sourceClassCount - 1);
    const archivedTuple = `${archivedSource.levelId}:${archivedSource.armLabel}:${archivedSource.track}`;
    expect(
      cloned.map((c) => `${c.levelId}:${c.armLabel}:${c.track}`),
    ).not.toContain(archivedTuple);
  });

  it("skips classes whose level is archived and reports them", async () => {
    const target = await makeTarget();
    const jss3 = one(
      await db
        .select()
        .from(levels)
        .where(and(eq(levels.schoolId, schoolId), eq(levels.name, "JSS 3"))),
    );
    await db
      .update(levels)
      .set({ archivedAt: new Date() })
      .where(eq(levels.id, jss3.id));

    const result = await db.transaction((tx) =>
      cloneClasses(tx, actor, {
        fromSessionId: sourceSessionId,
        toSessionId: target.id,
      }),
    );

    expect(result.cloned).toHaveLength(sourceClassCount - 1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      levelId: jss3.id,
      reason: "LEVEL_ARCHIVED",
    });
  });

  it("is idempotent on a second clone", async () => {
    const target = await makeTarget();
    await db.transaction((tx) =>
      cloneClasses(tx, actor, {
        fromSessionId: sourceSessionId,
        toSessionId: target.id,
      }),
    );

    const second = await db.transaction((tx) =>
      cloneClasses(tx, actor, {
        fromSessionId: sourceSessionId,
        toSessionId: target.id,
      }),
    );
    expect(second.cloned).toHaveLength(0);
  });

  it("refuses a locked target session", async () => {
    const target = one(
      await db
        .insert(academicSessions)
        .values({ schoolId, label: "2027/2028", closedAt: new Date() })
        .returning(),
    );

    await expect(
      db.transaction((tx) =>
        cloneClasses(tx, actor, {
          fromSessionId: sourceSessionId,
          toSessionId: target.id,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("refuses the same source and target session", async () => {
    await expect(
      db.transaction((tx) =>
        cloneClasses(tx, actor, {
          fromSessionId: sourceSessionId,
          toSessionId: sourceSessionId,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "SAME_SESSION" });
  });

  it("404s for another school's target session", async () => {
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
        cloneClasses(tx, actor, {
          fromSessionId: sourceSessionId,
          toSessionId: otherSession.id,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "SESSION_NOT_FOUND" });
  });
});
