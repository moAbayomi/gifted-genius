import buildApp from "../../../src/app.js";
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import {
  users,
  memberships,
  schools,
  sessions,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { apiPath } from "../../helpers/api.js";

const TEST_PASSWORD = "test-password-1234";

function buildTestApp() {
  return buildApp();
}

async function loginCookie(
  app: express.Express,
  email: string,
): Promise<string> {
  const res = await request(app)
    .post(apiPath("/auth/login"))
    .send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return res.headers["set-cookie"]![0]!.split(";")[0]!;
}

describe("requireAuth — session validity gate", () => {
  let app: express.Express;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildTestApp();
  });

  // ── Sanity: valid session works ──────────────────────────────────

  it("allows a valid session through to the handler", async () => {
    const cookie = await loginCookie(app, "teacher@demo.test");
    const res = await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.membershipId).toBeDefined();
  });

  // ── Membership suspended mid-session ─────────────────────────────

  it("kills the session on the next request when the membership is suspended", async () => {
    const cookie = await loginCookie(app, "teacher@demo.test");

    // Confirm the session works
    await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie)
      .expect(200);

    // Suspend the membership
    const teacher = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'teacher@demo.test'`),
    );
    const teacherMembership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, teacher.id)),
    );
    await db
      .update(memberships)
      .set({ status: "suspended" })
      .where(eq(memberships.id, teacherMembership.id));

    // Next request is refused
    const res = await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  // ── User suspended mid-session ───────────────────────────────────

  it("kills the session on the next request when the user is suspended", async () => {
    const cookie = await loginCookie(app, "teacher@demo.test");
    await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie)
      .expect(200);

    const teacher = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'teacher@demo.test'`),
    );
    await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, teacher.id));

    const res = await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  // ── School suspended mid-session ─────────────────────────────────

  it("kills the session on the next request when the school is suspended", async () => {
    const cookie = await loginCookie(app, "teacher@demo.test");
    await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie)
      .expect(200);

    const teacher = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'teacher@demo.test'`),
    );
    const teacherMembership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, teacher.id)),
    );
    await db
      .update(schools)
      .set({ status: "suspended" })
      .where(eq(schools.id, teacherMembership.schoolId));

    const res = await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  // ── Session expired mid-session ──────────────────────────────────

  it("kills the session on the next request when the session has expired", async () => {
    const cookie = await loginCookie(app, "teacher@demo.test");
    await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie)
      .expect(200);

    const teacher = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'teacher@demo.test'`),
    );
    // Set expiresAt in the past
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, teacher.id));

    const res = await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("kills the session when the session row is deleted", async () => {
    const cookie = await loginCookie(app, "teacher@demo.test");
    await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie)
      .expect(200);

    const teacher = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'teacher@demo.test'`),
    );
    await db.delete(sessions).where(eq(sessions.userId, teacher.id));

    const res = await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
  });

  it("allows opt-in routes through when mustChangePassword is true", async () => {
    // Force the flag
    await db
      .update(users)
      .set({ mustChangePassword: true })
      .where(sql`lower(${users.email}) = 'teacher@demo.test'`);

    const cookie = await loginCookie(app, "teacher@demo.test");

    // Default route — blocked
    await request(app)
      .get("/__test/protected")
      .set("Cookie", cookie)
      .expect(403);

    // Opt-in route — allowed
    await request(app)
      .get("/__test/pending-ok")
      .set("Cookie", cookie)
      .expect(200);
  });
});
