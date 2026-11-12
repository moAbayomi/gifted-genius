import { describe, it, expect, beforeEach } from "vitest";
import { eq, asc } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  schools,
  academicSessions,
  levels,
  classes,
  users,
  memberships,
  auditLog,
  subjects,
  classSubjects,
} from "../../../../src/db/schema/index.js";
import {
  createClass,
  listClasses,
  updateClass,
  archiveClass,
  unarchiveClass,
} from "../../../../src/modules/academics/classes/service.js";
import {
  createClassSchema,
  updateClassSchema,
} from "../../../../src/modules/academics/classes/schema.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";
import { archiveLevel } from "../../../../src/modules/academics/levels/service.js";
import { archiveSubject } from "../../../../src/modules/academics/subjects/service.js";

describe("classes — integration", () => {
  let school: typeof schools.$inferSelect;
  let session: typeof academicSessions.$inferSelect;
  let jss1: typeof levels.$inferSelect; // junior
  let sss1: typeof levels.$inferSelect; // senior
  let user: typeof users.$inferSelect;
  let membership: typeof memberships.$inferSelect;
  let actor: Actor;

  beforeEach(async () => {
    // setup.ts truncates; we only seed
    school = one(
      await db.insert(schools).values({ name: "S", slug: "s" }).returning(),
    );

    session = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2025/2026" })
        .returning(),
    );

    jss1 = one(
      await db
        .insert(levels)
        .values({
          schoolId: school.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
    sss1 = one(
      await db
        .insert(levels)
        .values({
          schoolId: school.id,
          name: "SSS1",
          sequence: 4,
          stage: "senior",
        })
        .returning(),
    );

    // Real membership so the audit FK (actor_membership_id, school_id) passes
    user = one(
      await db
        .insert(users)
        .values({ email: "admin@s.test", firstName: "A", lastName: "B" })
        .returning(),
    );
    membership = one(
      await db
        .insert(memberships)
        .values({ userId: user.id, schoolId: school.id })
        .returning(),
    );

    actor = {
      userId: user.id,
      membershipId: membership.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(["academics:read", "structure:manage"]),
    };
  });

  // Enter through Zod so `.trim()` applies. Bypassing the schema would
  // silently test "the service doesn't trim" — which is by design.
  const makeClass = (overrides: Record<string, unknown> = {}) => {
    const input = createClassSchema.parse({
      sessionId: session.id,
      levelId: jss1.id,
      armLabel: "A",
      track: "general",
      ...overrides,
    });
    return db.transaction((tx) => createClass(tx, actor, input));
  };

  // ── #1 Trim ──────────────────────────────────────────────────────
  it("trims leading/trailing whitespace from armLabel", async () => {
    const created = await makeClass({ armLabel: "  A  " });
    expect(created.armLabel).toBe("A");
  });

  // ── #2 Duplicate ─────────────────────────────────────────────────
  it("409 CLASS_ALREADY_EXISTS on duplicate (session, level, arm, track)", async () => {
    await makeClass({ armLabel: "A", track: "general" });
    await expect(
      makeClass({ armLabel: "A", track: "general" }),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ALREADY_EXISTS" });
  });

  it("409 CLASS_ARCHIVED_EXISTS when recreating an archived class", async () => {
    const created = await makeClass({ armLabel: "H", track: "general" });
    await db.transaction((tx) => archiveClass(tx, actor, created.id));

    await expect(
      makeClass({ armLabel: "H", track: "general" }),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ARCHIVED_EXISTS" });
  });

  // ── #3 Senior multi-track ────────────────────────────────────────
  it("senior class with same arm and different tracks coexist", async () => {
    const sci = await makeClass({
      levelId: sss1.id,
      armLabel: "A",
      track: "science",
    });
    const art = await makeClass({
      levelId: sss1.id,
      armLabel: "A",
      track: "arts",
    });
    const com = await makeClass({
      levelId: sss1.id,
      armLabel: "A",
      track: "commercial",
    });

    // All three valid, all on the same (session, level, arm)
    expect([sci.track, art.track, com.track]).toEqual([
      "science",
      "arts",
      "commercial",
    ]);
  });

  // ── #4 INVALID_TRACK ─────────────────────────────────────────────
  it("400 INVALID_TRACK for a junior class with a non-general track", async () => {
    await expect(
      makeClass({ levelId: jss1.id, track: "science" }),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_TRACK" });
  });

  it("400 INVALID_TRACK for a senior class with the 'general' track", async () => {
    // The other direction of the same rule — worth having, the schema's
    // default silently fills "general" for omitted tracks.
    await expect(
      makeClass({ levelId: sss1.id, track: "general" }),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_TRACK" });
  });

  // ── #5 Archived level ────────────────────────────────────────────
  it("409 LEVEL_ARCHIVED when creating a class on an archived level", async () => {
    await db.transaction((tx) => archiveLevel(tx, actor, jss1.id));
    await expect(makeClass({ levelId: jss1.id })).rejects.toMatchObject({
      httpStatus: 409,
      code: "LEVEL_ARCHIVED",
    });
  });

  // ── #6 Locked session ────────────────────────────────────────────
  it("409 SESSION_LOCKED when creating a class in a locked session", async () => {
    const locked = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId: school.id,
          label: "2024/2025",
          closedAt: new Date(),
        })
        .returning(),
    );

    await expect(makeClass({ sessionId: locked.id })).rejects.toMatchObject({
      httpStatus: 409,
      code: "SESSION_LOCKED",
    });
  });

  // ── #7 List by session, archived excluded ────────────────────────
  it("lists classes by session, excluding archived by default", async () => {
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId: school.id,
          label: "2026/2027",
        })
        .returning(),
    );

    const a = await makeClass({ armLabel: "A" }); // session, live
    const b = await makeClass({ armLabel: "B" }); // session, will archive
    const c = await makeClass({ sessionId: otherSession.id, armLabel: "A" }); // other session
    await db.transaction((tx) => archiveClass(tx, actor, b.id));

    // Default: session's live classes only
    const live = await db.transaction((tx) =>
      listClasses(tx, actor, { sessionId: session.id }),
    );
    expect(live.map((r) => r.id).sort()).toEqual([a.id]);

    // includeArchived: session's live + archived
    const all = await db.transaction((tx) =>
      listClasses(tx, actor, { sessionId: session.id, includeArchived: true }),
    );
    expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());

    // c never appears in either — different session
    expect(live.find((r) => r.id === c.id)).toBeUndefined();
    expect(all.find((r) => r.id === c.id)).toBeUndefined();
  });

  // ── #8 Archive/unarchive + audit ────────────────────────────────
  it("archives and unarchives a class, writing audit rows", async () => {
    const created = await makeClass();
    const archived = await db.transaction((tx) =>
      archiveClass(tx, actor, created.id),
    );
    expect(archived.archivedAt).not.toBeNull();

    const unarchived = await db.transaction((tx) =>
      unarchiveClass(tx, actor, created.id),
    );
    expect(unarchived.archivedAt).toBeNull();

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, created.id))
      .orderBy(asc(auditLog.createdAt));

    expect(audits.map((a) => a.action)).toEqual([
      "class.created",
      "class.archived",
      "class.unarchived",
    ]);
  });

  // ── #9 Cross-school — 404 in all three shapes ────────────────────
  it("404 when archiving a class from another school", async () => {
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "Other", slug: "other" })
        .returning(),
    );
    const otherLevel = one(
      await db
        .insert(levels)
        .values({
          schoolId: otherSchool.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: otherSchool.id, label: "2025/2026" })
        .returning(),
    );
    const otherClass = one(
      await db
        .insert(classes)
        .values({
          schoolId: otherSchool.id,
          sessionId: otherSession.id,
          levelId: otherLevel.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );

    await expect(
      db.transaction((tx) => archiveClass(tx, actor, otherClass.id)),
    ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
  });

  it("404 when creating with a session from another school", async () => {
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "Other", slug: "other" })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: otherSchool.id, label: "2025/2026" })
        .returning(),
    );

    await expect(
      makeClass({ sessionId: otherSession.id }),
    ).rejects.toMatchObject({ httpStatus: 404, code: "SESSION_NOT_FOUND" });
  });

  it("404 when creating with a level from another school", async () => {
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "Other", slug: "other" })
        .returning(),
    );
    const otherLevel = one(
      await db
        .insert(levels)
        .values({
          schoolId: otherSchool.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );

    await expect(makeClass({ levelId: otherLevel.id })).rejects.toMatchObject({
      httpStatus: 404,
      code: "LEVEL_NOT_FOUND",
    });
  });

  // ── #10 Update behavior ─────────────────────────────────────────
  it("rejects an empty update at the schema boundary", () => {
    expect(updateClassSchema.safeParse({}).success).toBe(false);
  });

  it("trims armLabel in the service even when the schema is bypassed", async () => {
    const created = await db.transaction((tx) =>
      createClass(tx, actor, {
        sessionId: session.id,
        levelId: jss1.id,
        armLabel: "  C  ",
        track: "general",
      }),
    );
    expect(created.armLabel).toBe("C");
  });

  it("updates and trims an arm label", async () => {
    const created = await makeClass({ armLabel: "A" });
    const updated = await db.transaction((tx) =>
      updateClass(tx, actor, created.id, { armLabel: "  B  " }),
    );
    expect(updated.armLabel).toBe("B");
  });

  it("409 CLASS_ALREADY_EXISTS when renaming into an existing arm", async () => {
    await makeClass({ armLabel: "A" });
    const b = await makeClass({ armLabel: "B" });

    await expect(
      db.transaction((tx) => updateClass(tx, actor, b.id, { armLabel: "A" })),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ALREADY_EXISTS" });
  });

  it("400 on an empty update passed directly to the service", async () => {
    const created = await makeClass();
    await expect(
      db.transaction((tx) => updateClass(tx, actor, created.id, {})),
    ).rejects.toMatchObject({ httpStatus: 400, code: "VALIDATION_ERROR" });
  });

  it("400 INVALID_TRACK when moving a junior class off general", async () => {
    const created = await makeClass({ levelId: jss1.id, track: "general" });
    await expect(
      db.transaction((tx) =>
        updateClass(tx, actor, created.id, { track: "science" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_TRACK" });
  });

  it("400 INVALID_TRACK when moving a senior class to general", async () => {
    const created = await makeClass({ levelId: sss1.id, track: "science" });
    await expect(
      db.transaction((tx) =>
        updateClass(tx, actor, created.id, { track: "general" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_TRACK" });
  });

  it("allows a valid senior track change", async () => {
    const created = await makeClass({ levelId: sss1.id, track: "science" });
    const updated = await db.transaction((tx) =>
      updateClass(tx, actor, created.id, { track: "arts" }),
    );
    expect(updated.track).toBe("arts");
  });

  it("409 CLASS_ARCHIVED when updating an archived class", async () => {
    const created = await makeClass();
    await db.transaction((tx) => archiveClass(tx, actor, created.id));

    await expect(
      db.transaction((tx) =>
        updateClass(tx, actor, created.id, { armLabel: "B" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ARCHIVED" });
  });

  it("409 LEVEL_ARCHIVED when updating a class under an archived level", async () => {
    const created = await makeClass({ armLabel: "Z" });

    // Direct update: archiveLevel() correctly refuses while a live class exists.
    // This simulates the corrupted state the guard must still catch.
    await db
      .update(levels)
      .set({ archivedAt: new Date() })
      .where(eq(levels.id, jss1.id));

    await expect(
      db.transaction((tx) =>
        updateClass(tx, actor, created.id, { armLabel: "Y" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_ARCHIVED" });
  });

  it("409 LEVEL_ARCHIVED when unarchiving a class under an archived level", async () => {
    const created = await makeClass();
    await db.transaction((tx) => archiveClass(tx, actor, created.id));
    await db
      .update(levels)
      .set({ archivedAt: new Date() })
      .where(eq(levels.id, jss1.id));

    await expect(
      db.transaction((tx) => unarchiveClass(tx, actor, created.id)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "LEVEL_ARCHIVED" });
  });

  it("404 when updating a class from another school", async () => {
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "Other", slug: "other" })
        .returning(),
    );
    const otherLevel = one(
      await db
        .insert(levels)
        .values({
          schoolId: otherSchool.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: otherSchool.id, label: "2025/2026" })
        .returning(),
    );
    const otherClass = one(
      await db
        .insert(classes)
        .values({
          schoolId: otherSchool.id,
          sessionId: otherSession.id,
          levelId: otherLevel.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );

    await expect(
      db.transaction((tx) =>
        updateClass(tx, actor, otherClass.id, { armLabel: "B" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
  });

  // ── Locked session ───────────────────────────────────────────────
  it("409 SESSION_LOCKED when updating a class in a locked session", async () => {
    const created = await makeClass();
    await db
      .update(academicSessions)
      .set({ closedAt: new Date() })
      .where(eq(academicSessions.id, session.id));

    await expect(
      db.transaction((tx) =>
        updateClass(tx, actor, created.id, { armLabel: "B" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("409 SESSION_LOCKED when archiving a class in a locked session", async () => {
    const created = await makeClass();
    await db
      .update(academicSessions)
      .set({ closedAt: new Date() })
      .where(eq(academicSessions.id, session.id));

    await expect(
      db.transaction((tx) => archiveClass(tx, actor, created.id)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("409 SESSION_LOCKED when unarchiving a class in a locked session", async () => {
    const created = await makeClass();
    await db.transaction((tx) => archiveClass(tx, actor, created.id));
    await db
      .update(academicSessions)
      .set({ closedAt: new Date() })
      .where(eq(academicSessions.id, session.id));

    await expect(
      db.transaction((tx) => unarchiveClass(tx, actor, created.id)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  // ── #11 2b todos ─────────────────────────────────────────────────
  // Split into two (not one combined) so each flips independently as
  // offerings / enrolments land.
  it("409 CLASS_HAS_OFFERINGS when the class has offerings", async () => {
    const cls = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: session.id,
          levelId: jss1.id,
          armLabel: "X",
          track: "general",
        })
        .returning(),
    );

    const subj = one(
      await db
        .insert(subjects)
        .values({
          schoolId: school.id,
          code: "MATH",
          name: "Mathematics",
        })
        .returning(),
    );

    await db.insert(classSubjects).values({
      schoolId: school.id,
      classId: cls.id,
      subjectId: subj.id,
      isCompulsory: true,
      electiveGroupId: null,
    });

    await expect(
      db.transaction((tx) => archiveClass(tx, actor, cls.id)),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "CLASS_HAS_OFFERINGS",
    });
  });

  it("archives a class with no offerings", async () => {
    const cls = one(
      await db
        .insert(classes)
        .values({
          schoolId: school.id,
          sessionId: session.id,
          levelId: jss1.id,
          armLabel: "X",
          track: "general",
        })
        .returning(),
    );

    const archived = await db.transaction((tx) =>
      archiveClass(tx, actor, cls.id),
    );
    expect(archived.archivedAt).not.toBeNull();
  });
  describe("subjects — archive guards", () => {
    it("409 SUBJECT_HAS_OFFERINGS when the subject is offered", async () => {
      const subj = one(
        await db
          .insert(subjects)
          .values({
            schoolId: school.id,
            code: "MATH",
            name: "Mathematics",
          })
          .returning(),
      );

      const cls = one(
        await db
          .insert(classes)
          .values({
            schoolId: school.id,
            sessionId: session.id,
            levelId: jss1.id,
            armLabel: "A",
            track: "general",
          })
          .returning(),
      );

      await db.insert(classSubjects).values({
        schoolId: school.id,
        classId: cls.id,
        subjectId: subj.id,
        isCompulsory: true,
        electiveGroupId: null,
      });

      await expect(
        db.transaction((tx) => archiveSubject(tx, actor, subj.id)),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "SUBJECT_HAS_OFFERINGS",
      });
    });

    it("archives a subject with no offerings", async () => {
      const subj = one(
        await db
          .insert(subjects)
          .values({
            schoolId: school.id,
            code: "UNUSED",
            name: "Unused",
          })
          .returning(),
      );

      const archived = await db.transaction((tx) =>
        archiveSubject(tx, actor, subj.id),
      );
      expect(archived.archivedAt).not.toBeNull();
    });
  });
});
