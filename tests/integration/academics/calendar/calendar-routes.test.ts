// tests/integration/academics/calendar-routes.test.ts
//
// HTTP-level coverage for the mounted calendar routes. The service tests use
// fabricated transactions; these go through requireAuth + requirePermission,
// path validation, the real app wiring, and the response envelope.
import { describe, it, expect, beforeEach } from "vitest";
import type express from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../../src/db/client.js";
import { seed } from "../../../../src/db/seed.js";
import buildApp from "../../../../src/app.js";
import { loginAsRole, TEST_PASSWORD } from "../../../helpers/auth.js";
import {
  schools,
  academicSessions,
  terms,
} from "../../../../src/db/schema/index.js";
import { one } from "../../../../src/shared/utils/assert.js";

describe("calendar routes", () => {
  let app: express.Express;
  let sessionId: string;
  let termIds: string[];

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    const seeded = await seed({ password: TEST_PASSWORD });
    app = buildApp();

    // The seed now owns an active Term 1 in 2026/2027. Close it so this
    // fixture can activate its own term (one active term per school).
    const seededActive = seeded.terms.find((term) => term.status === "active");
    if (seededActive) {
      await db
        .update(terms)
        .set({ status: "closed" })
        .where(eq(terms.id, seededActive.id));
    }

    const school = one(
      await db.select().from(schools).where(eq(schools.slug, "demo")),
    );
    const session = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2027/2028" })
        .returning(),
    );
    sessionId = session.id;

    const rows = await db
      .insert(terms)
      .values([
        {
          schoolId: school.id,
          sessionId,
          number: 1,
          name: "First Term",
          startDate: "2026-09-15",
          endDate: "2026-12-19",
        },
        {
          schoolId: school.id,
          sessionId,
          number: 2,
          name: "Second Term",
          startDate: "2027-01-05",
          endDate: "2027-04-03",
        },
        {
          schoolId: school.id,
          sessionId,
          number: 3,
          name: "Third Term",
          startDate: "2027-04-27",
          endDate: "2027-07-24",
        },
      ])
      .returning();

    termIds = rows.map((row) => row.id);
  });

  it("runs activate → close → lock → unlock through HTTP", async () => {
    const owner = await loginAsRole(app, "owner");

    for (const termId of termIds) {
      const activate = await owner
        .post(`/terms/${termId}/activate`)
        .send({ confirm: true });
      expect(activate.status).toBe(200);
      expect(activate.body).toEqual({ ok: true });

      const close = await owner
        .post(`/terms/${termId}/close`)
        .send({ confirm: true });
      expect(close.status).toBe(200);
      expect(close.body).toEqual({ ok: true });
    }

    const lock = await owner.post(`/sessions/${sessionId}/lock`);
    expect(lock.status).toBe(200);

    const unlock = await owner
      .post(`/sessions/${sessionId}/unlock`)
      .send({ reason: "Correcting a late enrollment" });
    expect(unlock.status).toBe(200);
  });

  it("rejects a malformed term ID with 400 before touching Postgres", async () => {
    const owner = await loginAsRole(app, "owner");

    const res = await owner.post("/terms/not-a-uuid/activate");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for another school's session", async () => {
    const owner = await loginAsRole(app, "owner");
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

    const res = await owner.post(`/sessions/${otherSession.id}/lock`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("forbids a teacher, who lacks calendar:manage", async () => {
    const teacher = await loginAsRole(app, "teacher");

    const res = await teacher
      .post(`/terms/${termIds[0]}/activate`)
      .send({ confirm: true });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
