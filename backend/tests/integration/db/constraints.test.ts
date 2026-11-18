// tests/integration/db/constraints.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { one } from "../../../src/shared/utils/assert.js";
import {
  schools,
  academicSessions,
  terms,
  levels,
  classes,
} from "../../../src/db/schema/index.js";

// ── Helpers ────────────────────────────────────────────────────────

function hasPgConstraint(err: unknown, constraintName: string): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const e = current as { constraint?: string; cause?: unknown };
    if (e.constraint === constraintName) return true;
    current = e.cause;
  }
  return false;
}

async function expectConstraintViolation(
  promise: Promise<unknown>,
  constraintName: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }

  if (caught === undefined) {
    throw new Error(
      `Expected constraint violation on "${constraintName}", but query succeeded`,
    );
  }

  if (!hasPgConstraint(caught, constraintName)) {
    const err = caught as Error;
    const causeMsg =
      err.cause instanceof Error ? ` | cause: ${err.cause.message}` : "";
    throw new Error(
      `Expected constraint "${constraintName}", but got: ${err.message}${causeMsg}`,
    );
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe("database constraints — calendar", () => {
  let schoolA: typeof schools.$inferSelect;
  let schoolB: typeof schools.$inferSelect;
  let sessionA: typeof academicSessions.$inferSelect;
  let sessionA2: typeof academicSessions.$inferSelect;
  let sessionB: typeof academicSessions.$inferSelect;
  let levelJss1A: typeof levels.$inferSelect;
  let levelSs1A: typeof levels.$inferSelect;
  let levelJss1B: typeof levels.$inferSelect;

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE classes, terms, levels, academic_sessions, schools CASCADE`,
    );

    schoolA = one(
      await db
        .insert(schools)
        .values({ name: "School A", slug: "school-a" })
        .returning(),
    );
    schoolB = one(
      await db
        .insert(schools)
        .values({ name: "School B", slug: "school-b" })
        .returning(),
    );

    sessionA = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: schoolA.id, label: "2026/2027" })
        .returning(),
    );
    sessionA2 = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: schoolA.id, label: "2027/2028" })
        .returning(),
    );
    sessionB = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: schoolB.id, label: "2026/2027" })
        .returning(),
    );

    levelJss1A = one(
      await db
        .insert(levels)
        .values({
          schoolId: schoolA.id,
          name: "JSS 1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
    levelSs1A = one(
      await db
        .insert(levels)
        .values({
          schoolId: schoolA.id,
          name: "SS 1",
          sequence: 4,
          stage: "senior",
        })
        .returning(),
    );
    levelJss1B = one(
      await db
        .insert(levels)
        .values({
          schoolId: schoolB.id,
          name: "JSS 1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );
  });

  it("refuses two sessions with active terms in the same school, allows one per school", async () => {
    // Session A of School A gets an active term
    await db.insert(terms).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      number: 1,
      name: "First Term",
      startDate: "2026-09-15",
      endDate: "2026-12-19",
      status: "active",
    });

    await expectConstraintViolation(
      db.insert(terms).values({
        schoolId: schoolA.id,
        sessionId: sessionA2.id,
        number: 1,
        name: "First Term",
        startDate: "2027-09-15",
        endDate: "2027-12-19",
        status: "active",
      }),
      "terms_one_active_per_school",
    );

    // Control: School B can have its own active term
    await db.insert(terms).values({
      schoolId: schoolB.id,
      sessionId: sessionB.id,
      number: 1,
      name: "First Term",
      startDate: "2026-09-15",
      endDate: "2026-12-19",
      status: "active",
    });
    // (If the insert throws, this test fails — no assertion needed)
  });

  it("refuses two active terms in the same session, allows active + planned", async () => {
    await db.insert(terms).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      number: 1,
      name: "First Term",
      startDate: "2026-09-15",
      endDate: "2026-12-19",
      status: "active",
    });

    await expectConstraintViolation(
      db.insert(terms).values({
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        number: 2,
        name: "Second Term",
        startDate: "2027-01-05",
        endDate: "2027-04-03",
        status: "active",
      }),
      "terms_one_active_per_school",
    );

    // Control: planned + active coexists
    await db.insert(terms).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      number: 2,
      name: "Second Term",
      startDate: "2027-01-05",
      endDate: "2027-04-03",
      status: "planned",
    });
  });

  it("refuses a duplicate term number within a session, allows different numbers", async () => {
    await db.insert(terms).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      number: 1,
      name: "First Term",
      startDate: "2026-09-15",
      endDate: "2026-12-19",
    });

    await expectConstraintViolation(
      db.insert(terms).values({
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        number: 1,
        name: "Term One",
        startDate: "2027-01-05",
        endDate: "2027-04-03",
      }),
      "terms_session_number_uq",
    );

    // Control: different number, fine
    await db.insert(terms).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      number: 2,
      name: "Second Term",
      startDate: "2027-01-05",
      endDate: "2027-04-03",
    });
  });

  it("refuses a term pointing at another school's session, allows same-school", async () => {
    await expectConstraintViolation(
      db.insert(terms).values({
        schoolId: schoolA.id,
        sessionId: sessionB.id,
        number: 1,
        name: "First Term",
        startDate: "2026-09-15",
        endDate: "2026-12-19",
      }),
      "terms_session_school_fk",
    );

    // Control: same-school term succeeds
    await db.insert(terms).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      number: 1,
      name: "First Term",
      startDate: "2026-09-15",
      endDate: "2026-12-19",
    });
  });

  it("refuses reversed term dates, allows equal or ordered dates", async () => {
    await expectConstraintViolation(
      db.insert(terms).values({
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        number: 1,
        name: "First Term",
        startDate: "2026-12-19",
        endDate: "2026-09-15",
      }),
      "terms_dates_chk",
    );

    // Control: equal dates allowed
    await db.insert(terms).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      number: 1,
      name: "First Term",
      startDate: "2026-09-15",
      endDate: "2026-09-15",
    });
  });

  it("refuses a duplicate JSS arm, allows different arms and same-arm-different-track", async () => {
    await db.insert(classes).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      levelId: levelJss1A.id,
      armLabel: "A",
      track: "general",
    });

    await expectConstraintViolation(
      db.insert(classes).values({
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        levelId: levelJss1A.id,
        armLabel: "A",
        track: "general",
      }),
      "classes_session_level_arm_track_uq",
    );

    // Control 1: different arm on the same level
    await db.insert(classes).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      levelId: levelJss1A.id,
      armLabel: "B",
      track: "general",
    });

    // Control 2: SS 1 arm "A" with three different tracks — all coexist
    await db.insert(classes).values([
      {
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        levelId: levelSs1A.id,
        armLabel: "A",
        track: "science",
      },
      {
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        levelId: levelSs1A.id,
        armLabel: "A",
        track: "arts",
      },
      {
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        levelId: levelSs1A.id,
        armLabel: "A",
        track: "commercial",
      },
    ]);
    const ssClasses = await db
      .select()
      .from(classes)
      .where(eq(classes.levelId, levelSs1A.id));
    expect(ssClasses).toHaveLength(3);

    // Control 3: same arm+level+track in a different session
    await db.insert(classes).values({
      schoolId: schoolA.id,
      sessionId: sessionA2.id,
      levelId: levelJss1A.id,
      armLabel: "A",
      track: "general",
    });
  });

  it("refuses a class pointing at another school's session", async () => {
    await expectConstraintViolation(
      db.insert(classes).values({
        schoolId: schoolA.id,
        sessionId: sessionB.id,
        levelId: levelJss1A.id,
        armLabel: "X",
        track: "general",
      }),
      "classes_session_school_fk",
    );

    await db.insert(classes).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      levelId: levelJss1A.id,
      armLabel: "X",
      track: "general",
    });
  });

  it("refuses a class pointing at another school's level", async () => {
    await expectConstraintViolation(
      db.insert(classes).values({
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        levelId: levelJss1B.id,
        armLabel: "Y",
        track: "general",
      }),
      "classes_level_school_fk",
    );

    await db.insert(classes).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      levelId: levelJss1A.id,
      armLabel: "Y",
      track: "general",
    });
  });

  it("refuses a blank arm label", async () => {
    await expectConstraintViolation(
      db.insert(classes).values({
        schoolId: schoolA.id,
        sessionId: sessionA.id,
        levelId: levelJss1A.id,
        armLabel: "   ",
        track: "general",
      }),
      "classes_arm_label_chk",
    );

    await db.insert(classes).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      levelId: levelJss1A.id,
      armLabel: "A",
      track: "general",
    });
  });

  it("refuses an invalid track", async () => {
    await expectConstraintViolation(
      db.execute(sql`
        INSERT INTO classes (school_id, session_id, level_id, arm_label, track)
        VALUES (${schoolA.id}, ${sessionA.id}, ${levelJss1A.id}, 'T', 'bogus')
      `),
      "classes_track_chk",
    );

    await db.insert(classes).values({
      schoolId: schoolA.id,
      sessionId: sessionA.id,
      levelId: levelJss1A.id,
      armLabel: "T",
      track: "general",
    });
  });

  it("refuses a malformed session label, allows the canonical shape", async () => {
    await expectConstraintViolation(
      db.insert(academicSessions).values({
        schoolId: schoolB.id,
        label: "2026-2027",
      }),
      "academic_sessions_label_chk",
    );

    await db.insert(academicSessions).values({
      schoolId: schoolB.id,
      label: "2027/2028",
    });
  });

  it("refuses a duplicate session label in one school, allows it in another", async () => {
    await expectConstraintViolation(
      db.insert(academicSessions).values({
        schoolId: schoolA.id,
        label: "2026/2027",
      }),
      "academic_sessions_school_label_uq",
    );

    // Same label, different school — control
    const other = await db
      .select()
      .from(academicSessions)
      .where(
        and(
          eq(academicSessions.schoolId, schoolB.id),
          eq(academicSessions.label, "2026/2027"),
        ),
      );
    expect(other).toHaveLength(1);
  });

  it("roles_kind_chk rejects admin and accepts staff", async () => {
    await expectConstraintViolation(
      db.execute(sql`
        INSERT INTO roles (school_id, rank, key, name, is_system, kind)
        VALUES (${schoolA.id}, 30, 'probe-admin', 'Probe Admin', true, 'admin')
      `),
      "roles_kind_chk",
    );

    await db.execute(sql`
      INSERT INTO roles (school_id, rank, key, name, is_system, kind)
      VALUES (${schoolA.id}, 30, 'probe-staff', 'Probe Staff', true, 'staff')
    `);
  });
});
