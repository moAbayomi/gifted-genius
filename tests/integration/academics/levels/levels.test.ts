// tests/integration/academics/levels.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq, asc } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  schools, academicSessions, levels, classes,
  users, memberships, auditLog,
} from "../../../../src/db/schema/index.js";
import {
  createLevel, updateLevel, listLevels,
  archiveLevel, unarchiveLevel,
} from "../../../../src/modules/academics/levels/service.js";
import { createLevelSchema, updateLevelSchema } from "../../../../src/modules/academics/levels/schema.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

describe("levels — integration", () => {
  let school:     typeof schools.$inferSelect;
  let session:    typeof academicSessions.$inferSelect;
  let user:       typeof users.$inferSelect;
  let membership: typeof memberships.$inferSelect;
  let actor:      Actor;

  beforeEach(async () => {

    school = one(await db.insert(schools).values({ name: "S", slug: "s" }).returning());
    session = one(await db.insert(academicSessions)
      .values({ schoolId: school.id, label: "2025/2026" }).returning());

    // Real membership so the audit FK passes
    user = one(await db.insert(users).values({
      email: "admin@s.test", firstName: "A", lastName: "B",
    }).returning());
    membership = one(await db.insert(memberships).values({
      userId: user.id, schoolId: school.id,
    }).returning());

    actor = {
      userId:       user.id,
      membershipId: membership.id,
      schoolId:     school.id,
      rank:         100,
      permissions:  new Set(["academics:read", "structure:manage"]),
    };
  });

  // ── #1 Trim ────────────────────────────────────────────────────────
  it("trims leading/trailing whitespace from name", async () => {
    const input = createLevelSchema.parse({
      name: "  JSS 1  ", sequence: 1, stage: "junior",
    });
    const created = await db.transaction(tx => createLevel(tx, actor, input));
    expect(created.name).toBe("JSS 1");
  });

  // ── #2 Duplicate name ──────────────────────────────────────────────
  it("409 LEVEL_NAME_TAKEN on duplicate name", async () => {
    const input = createLevelSchema.parse({
      name: "JSS1", sequence: 1, stage: "junior",
    });
    await db.transaction(tx => createLevel(tx, actor, input));

    const dup = createLevelSchema.parse({
      name: "JSS1", sequence: 2, stage: "junior",
    });
    await expect(
      db.transaction(tx => createLevel(tx, actor, dup)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_NAME_TAKEN" });
  });

  // ── #3 Duplicate sequence ──────────────────────────────────────────
  it("409 LEVEL_SEQUENCE_TAKEN on duplicate sequence", async () => {
    const input = createLevelSchema.parse({
      name: "JSS1", sequence: 1, stage: "junior",
    });
    await db.transaction(tx => createLevel(tx, actor, input));

    const dup = createLevelSchema.parse({
      name: "JSS1-alt", sequence: 1, stage: "junior",
    });
    await expect(
      db.transaction(tx => createLevel(tx, actor, dup)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_SEQUENCE_TAKEN" });
  });

  // ── #4 List ordered by sequence ───────────────────────────────────
  it("lists levels ordered by sequence ascending", async () => {
    for (const [name, seq] of [["JSS3", 3], ["JSS1", 1], ["JSS2", 2]] as const) {
      const input = createLevelSchema.parse({ name, sequence: seq, stage: "junior" });
      await db.transaction(tx => createLevel(tx, actor, input));
    }
    const rows = await db.transaction(tx => listLevels(tx, actor, {}));
    expect(rows.map(r => r.name)).toEqual(["JSS1", "JSS2", "JSS3"]);
  });

  // ── #5/#6 Archive exclusion ────────────────────────────────────────
  it("excludes archived levels by default", async () => {
    const live   = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));
    const gone   = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS2", sequence: 2, stage: "junior" })));
    await db.transaction(tx => archiveLevel(tx, actor, gone.id));

    const rows = await db.transaction(tx => listLevels(tx, actor, {}));
    expect(rows.map(r => r.id)).toEqual([live.id]);
  });

  it("includes archived levels when includeArchived: true", async () => {
    await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));
    const gone = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS2", sequence: 2, stage: "junior" })));
    await db.transaction(tx => archiveLevel(tx, actor, gone.id));

    const rows = await db.transaction(tx =>
      listLevels(tx, actor, { includeArchived: true }));
    expect(rows).toHaveLength(2);
  });

  // ── #7 Archive no classes ──────────────────────────────────────────
  it("archives a level with no active classes", async () => {
    const lvl = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));
    const archived = await db.transaction(tx => archiveLevel(tx, actor, lvl.id));
    expect(archived.archivedAt).not.toBeNull();
  });

  // ── #8 Unarchive ───────────────────────────────────────────────────
  it("unarchives a level", async () => {
    const lvl = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));
    await db.transaction(tx => archiveLevel(tx, actor, lvl.id));
    const unarchived = await db.transaction(tx => unarchiveLevel(tx, actor, lvl.id));
    expect(unarchived.archivedAt).toBeNull();
  });

  // ── #9 Archive blocked by active class ─────────────────────────────
  it("409 LEVEL_HAS_ACTIVE_CLASSES when the level has a live class", async () => {
    const lvl = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));

    // Direct insert — we're testing the archive guard, not createClass
    await db.insert(classes).values({
      schoolId: school.id, sessionId: session.id, levelId: lvl.id,
      armLabel: "A", track: "general",
    });

    await expect(
      db.transaction(tx => archiveLevel(tx, actor, lvl.id)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_HAS_ACTIVE_CLASSES" });
  });

  // ── #10 Cross-school 404 ───────────────────────────────────────────
  it("404 for a level in another school", async () => {
    const otherSchool = one(await db.insert(schools)
      .values({ name: "Other", slug: "other" }).returning());
    const otherLevel = one(await db.insert(levels).values({
      schoolId: otherSchool.id, name: "JSS1", sequence: 1, stage: "junior",
    }).returning());

    // Actor from school A tries to read/edit/archive school B's level
    await expect(
      db.transaction(tx => updateLevel(tx, actor, otherLevel.id, { name: "X" })),
    ).rejects.toMatchObject({ httpStatus: 404, code: "LEVEL_NOT_FOUND" });

    await expect(
      db.transaction(tx => archiveLevel(tx, actor, otherLevel.id)),
    ).rejects.toMatchObject({ httpStatus: 404, code: "LEVEL_NOT_FOUND" });
  });

  // ── #11 Audit rows ─────────────────────────────────────────────────
  it("writes audit rows for create/update/archive/unarchive", async () => {
    const input = createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" });
    const created = await db.transaction(tx => createLevel(tx, actor, input));
    await db.transaction(tx => updateLevel(tx, actor, created.id, { name: "JSS1-renamed" }));
    await db.transaction(tx => archiveLevel(tx, actor, created.id));
    await db.transaction(tx => unarchiveLevel(tx, actor, created.id));

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, created.id))
      .orderBy(asc(auditLog.createdAt));

    expect(audits.map(a => a.action)).toEqual([
      "level.created",
      "level.updated",
      "level.archived",
      "level.unarchived",
    ]);

    // Snapshot check — `before` is populated on update
    const upd = audits.find(a => a.action === "level.updated")!;
    expect(upd.before).toMatchObject({ name: "JSS1" });
    expect(upd.after).toMatchObject({ name: "JSS1-renamed" });
  });

  // ── #12 Service-level trim (bypassing Zod) ───────────────────────
  it("trims names in the service even when the schema is bypassed", async () => {
    const created = await db.transaction(tx =>
      createLevel(tx, actor, {
        name: "  JSS 9  ",
        sequence: 9,
        stage: "junior",
      }),
    );
    expect(created.name).toBe("JSS 9");

    const updated = await db.transaction(tx =>
      updateLevel(tx, actor, created.id, { name: "  Renamed  " }),
    );
    expect(updated.name).toBe("Renamed");
  });

  // ── #13 Empty update schema ──────────────────────────────────────
  it("rejects an empty update at the schema boundary", () => {
    expect(updateLevelSchema.safeParse({}).success).toBe(false);
  });

  // ── #14 Duplicate on update ──────────────────────────────────────
  it("409s on duplicate name/sequence when updating", async () => {
    const a = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));
    const b = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS2", sequence: 2, stage: "junior" })));

    await expect(
      db.transaction(tx => updateLevel(tx, actor, b.id, { name: a.name })),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_NAME_TAKEN" });

    await expect(
      db.transaction(tx => updateLevel(tx, actor, b.id, { sequence: a.sequence })),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_SEQUENCE_TAKEN" });
  });

  // ── #15 Archived rows are read-only ──────────────────────────────
  it("409 LEVEL_ARCHIVED when updating an archived level", async () => {
    const lvl = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));
    await db.transaction(tx => archiveLevel(tx, actor, lvl.id));

    await expect(
      db.transaction(tx => updateLevel(tx, actor, lvl.id, { name: "Renamed" })),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_ARCHIVED" });
  });

  // ── #16 Archive is idempotent ────────────────────────────────────
  it("archiving twice is a no-op and writes one audit row", async () => {
    const lvl = await db.transaction(tx =>
      createLevel(tx, actor, createLevelSchema.parse({ name: "JSS1", sequence: 1, stage: "junior" })));

    const first = await db.transaction(tx => archiveLevel(tx, actor, lvl.id));
    const second = await db.transaction(tx => archiveLevel(tx, actor, lvl.id));

    expect(second.archivedAt?.getTime()).toBe(first.archivedAt?.getTime());

    const archived = (await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, lvl.id)))
      .filter((row) => row.action === "level.archived");
    expect(archived).toHaveLength(1);
  });
});