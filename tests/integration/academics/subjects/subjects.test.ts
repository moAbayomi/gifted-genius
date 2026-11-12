// tests/integration/academics/subjects.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import {
  schools, users, memberships, auditLog,
  type School,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";
import {
  createSubject, listSubjects, updateSubject, archiveSubject,
} from "../../../../src/modules/academics/subjects/service.js";
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
    await db.insert(users).values({
      email: `${slug}-${crypto.randomUUID()}@test`,
      firstName: "T",
      lastName: "T",
    }).returning(),
  );
  const membership = one(
    await db.insert(memberships).values({
      userId: user.id,
      schoolId: school.id,
    }).returning(),
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

describe("subjects — integration", () => {
  let a: TestActor;
  let b: TestActor;
  let readOnly: Actor;
  let noPerm: Actor;

  beforeEach(async () => {
    // setup.ts truncates users, schools CASCADE — clean DB here.
    a = await makeSchoolWithActor("A", "a");
    b = await makeSchoolWithActor("B", "b");
    readOnly = (await makeSchoolWithActor("RA", "ra", ["academics:read"])).actor;
    noPerm   = (await makeSchoolWithActor("NA", "na", [])).actor;
  });

  // ── create ────────────────────────────────────────────────────────

  it("create normalizes code (trim + uppercase) and name (trim)", async () => {
    const s = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: " mth 101 ", name: "  Mathematics  " }),
    );
    expect(s.code).toBe("MTH 101");
    expect(s.name).toBe("Mathematics");
  });

  it("duplicate code in the same school → 409 SUBJECT_CODE_TAKEN", async () => {
    await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH101", name: "Mathematics" }),
    );
    await expect(
      db.transaction((tx) =>
        createSubject(tx, a.actor, { code: "MTH101", name: "Other" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SUBJECT_CODE_TAKEN" });
  });

  it("same code in another school → succeeds (control for tenancy)", async () => {
    await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH101", name: "Mathematics" }),
    );
    const s = await db.transaction((tx) =>
      createSubject(tx, b.actor, { code: "MTH101", name: "Mathematics" }),
    );
    expect(s.schoolId).toBe(b.school.id);
  });

  it("duplicate archived code → 409 SUBJECT_ARCHIVED_EXISTS", async () => {
    const s = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH101", name: "Mathematics" }),
    );
    await db.transaction((tx) => archiveSubject(tx, a.actor, s.id));
    await expect(
      db.transaction((tx) =>
        createSubject(tx, a.actor, { code: "MTH101", name: "Mathematics" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SUBJECT_ARCHIVED_EXISTS" });
  });

  // ── update ────────────────────────────────────────────────────────

  it("update normalizes code and name", async () => {
    const s = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH", name: "Math" }),
    );
    const u = await db.transaction((tx) =>
      updateSubject(tx, a.actor, s.id, { code: " mth 200 ", name: "  Maths  " }),
    );
    expect(u.code).toBe("MTH 200");
    expect(u.name).toBe("Maths");
  });

  it("update rejects empty name (control: valid name succeeds)", async () => {
    const s = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH", name: "Math" }),
    );
    await expect(
      db.transaction((tx) => updateSubject(tx, a.actor, s.id, { name: "   " })),
    ).rejects.toMatchObject({ httpStatus: 400 });
    const u = await db.transaction((tx) =>
      updateSubject(tx, a.actor, s.id, { name: "Mathematics" }),
    );
    expect(u.name).toBe("Mathematics");
  });

  it("update archived → 409 SUBJECT_ARCHIVED", async () => {
    const s = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH", name: "Math" }),
    );
    await db.transaction((tx) => archiveSubject(tx, a.actor, s.id));
    await expect(
      db.transaction((tx) => updateSubject(tx, a.actor, s.id, { name: "X" })),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SUBJECT_ARCHIVED" });
  });

  // ── archive ───────────────────────────────────────────────────────

  it("archive is idempotent and writes exactly one audit row", async () => {
    const s = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH", name: "Math" }),
    );
    await db.transaction((tx) => archiveSubject(tx, a.actor, s.id));
    await db.transaction((tx) => archiveSubject(tx, a.actor, s.id));

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, s.id));
    const archived = audits.filter((x) => x.action === "subject.archived");
    expect(archived).toHaveLength(1);
  });

  // ── list ──────────────────────────────────────────────────────────

  it("list hides archived by default; includeArchived shows them", async () => {
    const s1 = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "A1", name: "A1" }),
    );
    const s2 = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "B1", name: "B1" }),
    );
    await db.transaction((tx) => archiveSubject(tx, a.actor, s2.id));

    const live = await listSubjects(db, a.actor);
    expect(live.map((s) => s.id).sort()).toEqual([s1.id].sort());

    const all = await listSubjects(db, a.actor, { includeArchived: true });
    expect(all.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it("includeArchived requires structure:manage", async () => {
    await expect(
      listSubjects(db, readOnly, { includeArchived: true }),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });

  // ── tenancy / auth ────────────────────────────────────────────────

  it("cross-school subject ID → 404 SUBJECT_NOT_FOUND (not 403)", async () => {
    const s = await db.transaction((tx) =>
      createSubject(tx, a.actor, { code: "MTH", name: "Math" }),
    );
    await expect(
      db.transaction((tx) => updateSubject(tx, b.actor, s.id, { name: "X" })),
    ).rejects.toMatchObject({ httpStatus: 404, code: "SUBJECT_NOT_FOUND" });
  });

  it("unauthorized role → 403 on create", async () => {
    await expect(
      db.transaction((tx) =>
        createSubject(tx, noPerm, { code: "MTH", name: "Math" }),
      ),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });
});