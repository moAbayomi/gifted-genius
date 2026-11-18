// tests/integration/academics/elective-groups.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  schools,
  users,
  memberships,
  academicSessions,
  levels,
  classes,
  auditLog,
  type School,
  type AcademicSession,
  type Class,
  electiveGroups,
  subjects,
  classSubjects,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  createElectiveGroup,
  listElectiveGroups,
  updateElectiveGroup,
  archiveElectiveGroup,
} from "../../../../src/modules/academics/elective-groups/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";
import type { Permission } from "../../../../src/modules/rbac/permissions.js";
type TestActor = { school: School; actor: Actor };

async function makeSchoolWithActor(
  name: string,
  slug: string,
  perms: Permission[] = ["academics:read", "structure:manage"],
): Promise<TestActor> {
  const school = one(
    await db.insert(schools).values({ name, slug }).returning(),
  );
  const user = one(
    await db
      .insert(users)
      .values({
        email: `${slug}-${crypto.randomUUID()}@test`,
        firstName: "T",
        lastName: "T",
      })
      .returning(),
  );
  const membership = one(
    await db
      .insert(memberships)
      .values({
        userId: user.id,
        schoolId: school.id,
      })
      .returning(),
  );
  return {
    school,
    actor: {
      userId: user.id,
      membershipId: membership.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(perms),
    },
  };
}

describe("elective-groups — integration", () => {
  let a: TestActor;
  let b: TestActor;
  let readOnly: Actor;

  let sessionOpen: AcademicSession;
  let sessionClosed: AcademicSession;
  let classA1: Class;
  let classA2: Class;
  let classClosed: Class;
  let classB: Class;

  let school: typeof schools.$inferSelect;
  let session: typeof academicSessions.$inferSelect;
  let jss1a: typeof classes.$inferSelect;
  let jss1: typeof levels.$inferSelect;
  let user: typeof users.$inferSelect;
  let membership: typeof memberships.$inferSelect;
  let actor: Actor;

  beforeEach(async () => {
    a = await makeSchoolWithActor("A", "a");
    b = await makeSchoolWithActor("B", "b");
    readOnly = (await makeSchoolWithActor("RA", "ra", ["academics:read"]))
      .actor;

    // School A: open and closed sessions
    sessionOpen = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId: a.school.id,
          label: "2025/2026",
        })
        .returning(),
    );
    sessionClosed = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId: a.school.id,
          label: "2024/2025",
          closedAt: new Date(),
        })
        .returning(),
    );

    const levelA = one(
      await db
        .insert(levels)
        .values({
          schoolId: a.school.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );

    classA1 = one(
      await db
        .insert(classes)
        .values({
          schoolId: a.school.id,
          sessionId: sessionOpen.id,
          levelId: levelA.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );
    classA2 = one(
      await db
        .insert(classes)
        .values({
          schoolId: a.school.id,
          sessionId: sessionOpen.id,
          levelId: levelA.id,
          armLabel: "B",
          track: "general",
        })
        .returning(),
    );
    classClosed = one(
      await db
        .insert(classes)
        .values({
          schoolId: a.school.id,
          sessionId: sessionClosed.id,
          levelId: levelA.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );

    // School B: one open session + class, for cross-school tests
    const sessionB = one(
      await db
        .insert(academicSessions)
        .values({
          schoolId: b.school.id,
          label: "2025/2026",
        })
        .returning(),
    );
    const levelB = one(
      await db
        .insert(levels)
        .values({
          schoolId: b.school.id,
          name: "JSS1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
    classB = one(
      await db
        .insert(classes)
        .values({
          schoolId: b.school.id,
          sessionId: sessionB.id,
          levelId: levelB.id,
          armLabel: "A",
          track: "general",
        })
        .returning(),
    );

    // Seed school
    school = one(
      await db.insert(schools).values({ name: "S", slug: "s" }).returning(),
    );

    // Seed session
    session = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2025/2026" })
        .returning(),
    );

    // Seed levels
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

    // Seed classes
    jss1a = one(
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

    // Seed user + membership (so the audit FK passes)
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

    // Build the actor
    actor = {
      userId: user.id,
      membershipId: membership.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(["academics:read", "structure:manage"]),
    };
  });

  // ── create ────────────────────────────────────────────────────────

  it("create derives sessionId from the class; caller-supplied session is ignored", async () => {
    expect(classA1.sessionId).toBe(sessionOpen.id);
    expect(sessionClosed.id).not.toBe(sessionOpen.id);

    const g = (await db.transaction((tx) =>
      (createElectiveGroup as any)(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 1,
        sessionId: sessionClosed.id, // caller tries to override
      }),
    )) as Awaited<ReturnType<typeof createElectiveGroup>>;
    expect(g.sessionId).toBe(sessionOpen.id); // derived from the class, not from input
  });

  it("closed session → 409 SESSION_LOCKED on create", async () => {
    await expect(
      db.transaction((tx) =>
        createElectiveGroup(tx, a.actor, {
          classId: classClosed.id,
          name: "Religion",
          minChoices: 1,
          maxChoices: 1,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("min/max invalid → 400 INVALID_GROUP_RANGE", async () => {
    await expect(
      db.transaction((tx) =>
        createElectiveGroup(tx, a.actor, {
          classId: classA1.id,
          name: "G",
          minChoices: -1,
          maxChoices: 2,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_GROUP_RANGE" });

    await expect(
      db.transaction((tx) =>
        createElectiveGroup(tx, a.actor, {
          classId: classA1.id,
          name: "G2",
          minChoices: 3,
          maxChoices: 1,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 400, code: "INVALID_GROUP_RANGE" });
  });

  it("duplicate name in same class → 409 ELECTIVE_GROUP_NAME_TAKEN", async () => {
    await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    await expect(
      db.transaction((tx) =>
        createElectiveGroup(tx, a.actor, {
          classId: classA1.id,
          name: "Religion",
          minChoices: 0,
          maxChoices: 1,
        }),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "ELECTIVE_GROUP_NAME_TAKEN",
    });
  });

  it("same name in another class → succeeds (control)", async () => {
    await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA2.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    expect(g.classId).toBe(classA2.id);
  });

  it("duplicate archived name → 409 ELECTIVE_GROUP_ARCHIVED_EXISTS", async () => {
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    await db.transaction((tx) => archiveElectiveGroup(tx, a.actor, g.id));
    await expect(
      db.transaction((tx) =>
        createElectiveGroup(tx, a.actor, {
          classId: classA1.id,
          name: "Religion",
          minChoices: 1,
          maxChoices: 2,
        }),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "ELECTIVE_GROUP_ARCHIVED_EXISTS",
    });
  });

  it("archived class → 409 CLASS_ARCHIVED (create, update, archive)", async () => {
    await db
      .update(classes)
      .set({ archivedAt: new Date() })
      .where(eq(classes.id, classA1.id));

    await expect(
      db.transaction((tx) =>
        createElectiveGroup(tx, a.actor, {
          classId: classA1.id,
          name: "Archived class group",
          minChoices: 1,
          maxChoices: 1,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ARCHIVED" });

    // Control: the other live class still accepts a group.
    const group = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA2.id,
        name: "Live class group",
        minChoices: 1,
        maxChoices: 1,
      }),
    );
    expect(group.classId).toBe(classA2.id);

    // Once the class is archived, both update and archive are refused too.
    await db
      .update(classes)
      .set({ archivedAt: new Date() })
      .where(eq(classes.id, classA2.id));

    await expect(
      db.transaction((tx) =>
        updateElectiveGroup(tx, a.actor, group.id, { name: "Renamed" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ARCHIVED" });

    await expect(
      db.transaction((tx) => archiveElectiveGroup(tx, a.actor, group.id)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "CLASS_ARCHIVED" });
  });

  it("cross-school class → 404 CLASS_NOT_FOUND (not 403)", async () => {
    await expect(
      db.transaction((tx) =>
        createElectiveGroup(tx, a.actor, {
          classId: classB.id,
          name: "Religion",
          minChoices: 1,
          maxChoices: 2,
        }),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "CLASS_NOT_FOUND" });
  });

  // ── update ────────────────────────────────────────────────────────

  it("update changes name/min/max and writes audit", async () => {
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 1,
      }),
    );
    const u = await db.transaction((tx) =>
      updateElectiveGroup(tx, a.actor, g.id, {
        name: "Religious Studies",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    expect(u.name).toBe("Religious Studies");
    expect(u.minChoices).toBe(1);
    expect(u.maxChoices).toBe(2);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, g.id));
    const upd = audits.find((x) => x.action === "elective_group.updated");
    expect(upd).toBeTruthy();
    expect((upd!.before as any).name).toBe("Religion");
    expect((upd!.after as any).name).toBe("Religious Studies");
  });

  it("update archived → 409 ELECTIVE_GROUP_ARCHIVED", async () => {
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 1,
      }),
    );
    await db.transaction((tx) => archiveElectiveGroup(tx, a.actor, g.id));
    await expect(
      db.transaction((tx) =>
        updateElectiveGroup(tx, a.actor, g.id, { name: "X" }),
      ),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "ELECTIVE_GROUP_ARCHIVED",
    });
  });

  it("closed session → 409 SESSION_LOCKED on update", async () => {
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    // Simulate lockSession having closed the session after group creation.
    await db.execute(
      sql`UPDATE academic_sessions SET closed_at = now() WHERE id = ${sessionOpen.id}`,
    );
    await expect(
      db.transaction((tx) =>
        updateElectiveGroup(tx, a.actor, g.id, { name: "X" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  // ── archive ───────────────────────────────────────────────────────

  it("archive is idempotent and writes exactly one audit row", async () => {
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    await db.transaction((tx) => archiveElectiveGroup(tx, a.actor, g.id));
    await db.transaction((tx) => archiveElectiveGroup(tx, a.actor, g.id));

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, g.id));
    const archived = audits.filter(
      (x) => x.action === "elective_group.archived",
    );
    expect(archived).toHaveLength(1);
  });

  it("closed session → 409 SESSION_LOCKED on archive", async () => {
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    await db.execute(
      sql`UPDATE academic_sessions SET closed_at = now() WHERE id = ${sessionOpen.id}`,
    );
    await expect(
      db.transaction((tx) => archiveElectiveGroup(tx, a.actor, g.id)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  // ── list ──────────────────────────────────────────────────────────

  it("list filters by class and hides archived by default", async () => {
    const g1 = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 1,
      }),
    );
    const g2 = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Trade",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    const g3 = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA2.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 1,
      }),
    );
    await db.transaction((tx) => archiveElectiveGroup(tx, a.actor, g2.id));

    const a1Live = await listElectiveGroups(db, a.actor, {
      classId: classA1.id,
    });
    expect(a1Live.map((g) => g.id).sort()).toEqual([g1.id].sort());

    const a2Live = await listElectiveGroups(db, a.actor, {
      classId: classA2.id,
    });
    expect(a2Live.map((g) => g.id).sort()).toEqual([g3.id].sort());

    const a1All = await listElectiveGroups(db, a.actor, {
      classId: classA1.id,
      includeArchived: true,
    });
    expect(a1All.map((g) => g.id).sort()).toEqual([g1.id, g2.id].sort());
  });

  it("includeArchived requires structure:manage", async () => {
    await expect(
      listElectiveGroups(db, readOnly, {
        classId: classA1.id,
        includeArchived: true,
      }),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });

  // ── tenancy ───────────────────────────────────────────────────────

  it("cross-school group ID → 404 ELECTIVE_GROUP_NOT_FOUND", async () => {
    const g = await db.transaction((tx) =>
      createElectiveGroup(tx, a.actor, {
        classId: classA1.id,
        name: "Religion",
        minChoices: 1,
        maxChoices: 2,
      }),
    );
    await expect(
      db.transaction((tx) =>
        updateElectiveGroup(tx, b.actor, g.id, { name: "X" }),
      ),
    ).rejects.toMatchObject({
      httpStatus: 404,
      code: "ELECTIVE_GROUP_NOT_FOUND",
    });
  });

  describe("elective groups — archive guards", () => {
    it("409 ELECTIVE_GROUP_HAS_OFFERINGS when offerings reference it", async () => {
      const grp = one(
        await db
          .insert(electiveGroups)
          .values({
            schoolId: school.id,
            classId: jss1a.id,
            sessionId: session.id,
            name: "Religion",
            minChoices: 1,
            maxChoices: 1,
          })
          .returning(),
      );

      const subj = one(
        await db
          .insert(subjects)
          .values({
            schoolId: school.id,
            code: "CRS",
            name: "CRS",
          })
          .returning(),
      );

      await db.insert(classSubjects).values({
        schoolId: school.id,
        classId: jss1a.id,
        subjectId: subj.id,
        isCompulsory: false,
        electiveGroupId: grp.id,
      });

      await expect(
        db.transaction((tx) => archiveElectiveGroup(tx, actor, grp.id)),
      ).rejects.toMatchObject({
        httpStatus: 409,
        code: "ELECTIVE_GROUP_HAS_OFFERINGS",
      });
    });

    it("archives an elective group with no offerings", async () => {
      const grp = one(
        await db
          .insert(electiveGroups)
          .values({
            schoolId: school.id,
            classId: jss1a.id,
            sessionId: session.id,
            name: "Unused",
            minChoices: 0,
            maxChoices: 1,
          })
          .returning(),
      );

      const archived = await db.transaction((tx) =>
        archiveElectiveGroup(tx, actor, grp.id),
      );
      expect(archived.archivedAt).not.toBeNull();
    });
  });
});
