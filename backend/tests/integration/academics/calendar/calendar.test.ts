import { describe, it, expect, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import { one } from "../../../../src/shared/utils/assert.js";
import { canTransitionTerm, type TermStatus } from "../../../../src/modules/academics/calendar/transitions.js";
import {
  activateTerm,
  closeTerm,
  lockSession,
  unlockSession,
  checkTermsDoNotOverlap,
} from "../../../../src/modules/academics/calendar/service.js";
import {
  schools, academicSessions, terms, users, auditLog,
} from "../../../../src/db/schema/index.js";
import { createSchoolWithDefaults } from "../../../../src/modules/schools/service.js";
import type { Actor } from "../../../../src/modules/rbac/can.js";

describe("term transition table", () => {
  const ALL: TermStatus[] = ["planned", "active", "closed"];

  for (const from of ALL) {
    for (const to of ALL) {
      const expected =
        (from === "planned" && to === "active") ||
        (from === "active" && to === "closed");
      it(`${from} → ${to} is ${expected ? "allowed" : "refused"}`, () => {
        expect(canTransitionTerm(from, to)).toBe(expected);
      });
    }
  }
});

describe("calendar transitions — integration", () => {
  let school: typeof schools.$inferSelect;
  let session: typeof academicSessions.$inferSelect;
  let session2: typeof academicSessions.$inferSelect;
  let term1: typeof terms.$inferSelect;
  let term2: typeof terms.$inferSelect;
  let term3: typeof terms.$inferSelect;
  let otherSessionTerm: typeof terms.$inferSelect;
  let actor: Actor;

  beforeEach(async () => {

    // A real membership is required: audit_log.actor_membership_id is
    // FK-checked against memberships, so a fabricated ID would turn every
    // successful transition into a 23503 and roll the transaction back.
    const owner = one(
      await db
        .insert(users)
        .values({
          email: "owner@test.local",
          firstName: "Test",
          lastName: "Owner",
        })
        .returning(),
    );
    const created = await createSchoolWithDefaults({
      name: "S",
      slug: "s",
      ownerUserId: owner.id,
    });
    school = created.school;

    session = one(
      await db.insert(academicSessions).values({ schoolId: school.id, label: "2026/2027" }).returning(),
    );
    session2 = one(
      await db.insert(academicSessions).values({ schoolId: school.id, label: "2027/2028" }).returning(),
    );

    term1 = one(
      await db.insert(terms).values({
        schoolId: school.id, sessionId: session.id, number: 1,
        name: "First Term", startDate: "2026-09-15", endDate: "2026-12-19",
      }).returning(),
    );
    term2 = one(
      await db.insert(terms).values({
        schoolId: school.id, sessionId: session.id, number: 2,
        name: "Second Term", startDate: "2027-01-05", endDate: "2027-04-03",
      }).returning(),
    );
    term3 = one(
      await db.insert(terms).values({
        schoolId: school.id, sessionId: session.id, number: 3,
        name: "Third Term", startDate: "2027-04-26", endDate: "2027-07-23",
      }).returning(),
    );
    otherSessionTerm = one(
      await db.insert(terms).values({
        schoolId: school.id, sessionId: session2.id, number: 1,
        name: "First Term", startDate: "2027-09-15", endDate: "2027-12-19",
      }).returning(),
    );

    actor = {
      userId: owner.id,
      membershipId: created.ownerMembership.id,
      schoolId: school.id,
      rank: 100,
      permissions: new Set(["calendar:manage", "calendar:unlock"]),
    };
  });

  it("activates term 1 of an open session", async () => {
    await db.transaction((tx) => activateTerm(tx, actor, term1.id, true));
    const after = one(await db.select().from(terms).where(eq(terms.id, term1.id)));
    expect(after.status).toBe("active");
  });

  it("activating the next term closes the active term in the same transaction", async () => {
    await db.transaction((tx) => activateTerm(tx, actor, term1.id, true));

    await db.transaction((tx) =>
      activateTerm(tx, actor, otherSessionTerm.id, true),
    );

    const first = one(
      await db.select().from(terms).where(eq(terms.id, term1.id)),
    );
    const second = one(
      await db
        .select()
        .from(terms)
        .where(eq(terms.id, otherSessionTerm.id)),
    );
    expect(first.status).toBe("closed");
    expect(second.status).toBe("active");
  });

  it("refuses to skip a planned term", async () => {
    await db.transaction((tx) => activateTerm(tx, actor, term1.id, true));

    // Term 2 is still planned; term 3 is not the next term.
    await expect(
      db.transaction((tx) => activateTerm(tx, actor, term3.id, true)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "TERM_NOT_SEQUENTIAL" });

    // The failed attempt rolled back: term 1 is still active.
    const stillActive = one(
      await db.select().from(terms).where(eq(terms.id, term1.id)),
    );
    expect(stillActive.status).toBe("active");

    // Control: activating term 2 closes term 1 and succeeds.
    await db.transaction((tx) => activateTerm(tx, actor, term2.id, true));
    const after = one(await db.select().from(terms).where(eq(terms.id, term2.id)));
    expect(after.status).toBe("active");
    const first = one(
      await db.select().from(terms).where(eq(terms.id, term1.id)),
    );
    expect(first.status).toBe("closed");
  });

  it("refuses to close a term without confirm: true", async () => {
    await db.transaction((tx) => activateTerm(tx, actor, term1.id, true));

    await expect(
      db.transaction((tx) => closeTerm(tx, actor, term1.id, false)),
    ).rejects.toMatchObject({ httpStatus: 400, code: "CONFIRMATION_REQUIRED" });

    // Control: with confirm: true, it succeeds
    await db.transaction((tx) => closeTerm(tx, actor, term1.id, true));
    const after = one(await db.select().from(terms).where(eq(terms.id, term1.id)));
    expect(after.status).toBe("closed");
  });

  it("refuses to lock a session while any term is not closed", async () => {
    await db.transaction((tx) => activateTerm(tx, actor, term1.id, true));

    await expect(
      db.transaction((tx) => lockSession(tx, actor, session.id)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_HAS_OPEN_TERMS" });

    // Control: close every term, then lock
    await db.transaction((tx) => closeTerm(tx, actor, term1.id, true));
    // terms 2 and 3 are still 'planned', not closed — close them too
    // (in the real flow they'd have been activated first)
    await db.execute(sql`UPDATE terms SET status = 'closed' WHERE session_id = ${session.id}`);

    await db.transaction((tx) => lockSession(tx, actor, session.id));
    const after = one(await db.select().from(academicSessions).where(eq(academicSessions.id, session.id)));
    expect(after.closedAt).not.toBeNull();
  });

  it("refuses to activate a term in a locked session", async () => {
    await db.execute(sql`UPDATE terms SET status = 'closed' WHERE session_id = ${session.id}`);
    await db.transaction((tx) => lockSession(tx, actor, session.id));

    await expect(
      db.transaction((tx) => activateTerm(tx, actor, term1.id, true)),
    ).rejects.toMatchObject({ httpStatus: 409, code: "SESSION_LOCKED" });
  });

  it("refuses overlapping term dates via checkTermsDoNotOverlap", async () => {
    // Seed an existing term: Sep 15 - Dec 19
    // Overlap with existing term → 409
    await expect(
      db.transaction((tx) => checkTermsDoNotOverlap(tx, school.id, session.id, "2026-10-01", "2026-11-01")),
    ).rejects.toMatchObject({ httpStatus: 409, code: "TERM_DATES_OVERLAP" });

    // Control: adjacent dates pass
    await expect(
      db.transaction((tx) => checkTermsDoNotOverlap(tx, school.id, session.id, "2026-12-20", "2027-01-04")),
    ).resolves.not.toThrow();

    // Control: excluding the overlapping term by id passes
    await expect(
      db.transaction((tx) =>
        checkTermsDoNotOverlap(tx, school.id, session.id, "2026-10-01", "2026-11-01", term1.id),
      ),
    ).resolves.not.toThrow();
  });

  it("two simultaneous activations produce one success and one 409 (not a 500)", async () => {
    const results = await Promise.allSettled([
      db.transaction((tx) => activateTerm(tx, actor, term1.id, true)),
      db.transaction((tx) => activateTerm(tx, actor, term1.id, true)),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toMatchObject({ httpStatus: 409, code: "TERM_ALREADY_ACTIVE" });
  });

  it("returns 404 for terms and sessions that do not exist", async () => {
    await expect(
      db.transaction((tx) => activateTerm(tx, actor, crypto.randomUUID(), true)),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });

    await expect(
      db.transaction((tx) => closeTerm(tx, actor, crypto.randomUUID(), true)),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });

    await expect(
      db.transaction((tx) => lockSession(tx, actor, crypto.randomUUID())),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });

    await expect(
      db.transaction((tx) =>
        unlockSession(tx, actor, crypto.randomUUID(), "A sufficiently long reason"),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  it("never reads or mutates another school's session or term", async () => {
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "Other School", slug: "other-school" })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: otherSchool.id, label: "2026/2027" })
        .returning(),
    );
    const otherTerm = one(
      await db
        .insert(terms)
        .values({
          schoolId: otherSchool.id,
          sessionId: otherSession.id,
          number: 1,
          name: "First Term",
          startDate: "2026-09-15",
          endDate: "2026-12-19",
        })
        .returning(),
    );

    await expect(
      db.transaction((tx) => activateTerm(tx, actor, otherTerm.id, true)),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });

    await expect(
      db.transaction((tx) => lockSession(tx, actor, otherSession.id)),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });

    await db
      .update(academicSessions)
      .set({ closedAt: new Date() })
      .where(eq(academicSessions.id, otherSession.id));

    await expect(
      db.transaction((tx) =>
        unlockSession(tx, actor, otherSession.id, "Trying another school's session"),
      ),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });

    const after = one(
      await db
        .select()
        .from(academicSessions)
        .where(eq(academicSessions.id, otherSession.id)),
    );
    expect(after.closedAt).not.toBeNull();
  });

  it("unlocks a session and records the reason in the audit log", async () => {
    await db
      .update(academicSessions)
      .set({ closedAt: new Date() })
      .where(eq(academicSessions.id, session.id));

    const reason = "Correcting a late enrollment record";
    await db.transaction((tx) => unlockSession(tx, actor, session.id, reason));

    const after = one(
      await db
        .select()
        .from(academicSessions)
        .where(eq(academicSessions.id, session.id)),
    );
    expect(after.closedAt).toBeNull();

    const audit = one(
      await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "academic_year.reopened")),
    );
    expect(audit.schoolId).toBe(school.id);
    expect(audit.metadata).toMatchObject({ reason });
  });
});