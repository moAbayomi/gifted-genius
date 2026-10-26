// tests/integration/auth/login.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import { requireAuth } from "../../../src/modules/auth/middleware/require-auth.js";
import { createSchoolWithDefaults } from "../../../src/modules/schools/service.js";
import { hashPassword } from "../../../src/shared/utils/password.js";
import { authRouter } from "../../../src/modules/auth/routes.js";
import { errorHandler } from "../../../src/shared/middleware/error-handler.js";
import {
  users,
  memberships,
  schools,
  sessions,
  auditLog,
} from "../../../src/db/schema/index.js";
import { hashToken } from "../../../src/modules/auth/session.js";
import { one } from "../../../src/shared/utils/assert.js";
//import buildApp from "../../../src/app.js";
//import pino from "pino";
import { loginAsRole } from "../../helpers/auth.js";
import { usersRouter } from "../../../src/modules/users/routes.js";

const TEST_PASSWORD = "test-password-1234";

 function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
   app.use(authRouter);
   app.use(usersRouter)

  app.get("/protected", requireAuth(), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
} 

async function loginAsOwner(app: express.Express): Promise<string> {
  const res = await request(app).post("/auth/login").send({
    email: "owner@demo.test",
    password: TEST_PASSWORD,
  });
  const setCookie = res.headers["set-cookie"]![0]!;
  return setCookie.match(/session=([^;]+)/)![1]!;
}

describe("POST /auth/login", () => {
  let app: express.Express;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildTestApp();
  });

  // ── 1. Happy path ────────────────────────────────────────────────

  it("logs in with valid credentials and sets a session cookie", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "owner@demo.test", password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("success");

    // Cookie present and HttpOnly
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(setCookie![0]).toMatch(/session=/);
    expect(setCookie![0]).toMatch(/HttpOnly/i);
  });

  // ── 2. Wrong password → generic 401 ──────────────────────────────

  it("returns 401 with generic message for a wrong password", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "owner@demo.test", password: "definitely-wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.body.error.message).toBe("Invalid email or password");
    // No cookie on failure
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  // ── 3. Unknown email → SAME generic 401 (no enumeration) ─────────

  it("returns 401 with the SAME message for an unknown email", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "nobody@nowhere.test", password: "anything" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    // The EXACT same message as wrong-password — no hint about which
    expect(res.body.error.message).toBe("Invalid email or password");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  // ── 4. No active memberships → generic 401 ───────────────────────

  it("returns 401 when the user has no active memberships", async () => {
    // Create a user with a password but NO memberships
     await db
      .insert(users)
      .values({
        email: "orphan@test.com",
        passwordHash: await hashPassword(TEST_PASSWORD),
        firstName: "Orphan",
        lastName: "User",
      })
      .returning();

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "orphan@test.com", password: TEST_PASSWORD });

    // Generic 401 — don't reveal "you have no memberships" (account exists)
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  // ── 5. Multiple memberships, no slug → select_school, NO session ─

  it("returns select_school when the user has multiple memberships and no slug", async () => {
    // The seeded owner has 1 membership at "demo". Give them a second one.
    const owner = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'owner@demo.test'`),
    );

    // Create a second school + owner membership for the same user
    await createSchoolWithDefaults(
      {
        name: "Second School",
        slug: "second-school",
        ownerUserId: owner.id,
      },
      { via: "test" },
    );

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "owner@demo.test", password: TEST_PASSWORD });
    // Note: no schoolSlug in the body

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("select_school");
    expect(res.body.schools).toHaveLength(2);
    expect(res.body.schools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: "demo", name: expect.any(String) }),
        expect.objectContaining({
          slug: "second-school",
          name: expect.any(String),
        }),
      ]),
    );

    // CRITICAL — no session on select_school
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("logs in at a specific school when slug is provided for a multi-membership user", async () => {
    const owner = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'owner@demo.test'`),
    );
    await createSchoolWithDefaults(
      { name: "Second School", slug: "second-school", ownerUserId: owner.id },
      { via: "test" },
    );

    const secondSchool = one(
      await db.select().from(schools).where(eq(schools.slug, "second-school")),
    );
    const secondMembership = one(
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, owner.id),
            eq(memberships.schoolId, secondSchool.id),
          ),
        ),
    );

    const res = await request(app).post("/auth/login").send({
      email: "owner@demo.test",
      password: TEST_PASSWORD,
      schoolSlug: "second-school",
    });

    expect(res.status).toBe(200);
    expect(res.body.kind).toBe("success");

    // ← The real proof: the persisted session is scoped to the picked school
    const raw = res.headers["set-cookie"]![0]!.match(/session=([^;]+)/)![1]!;
    const session = one(
      await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashToken(raw))),
    );
    expect(session.activeMembershipId).toBe(secondMembership.id);
  });

  it("timing: unknown email responds in similar time to wrong password", async () => {
    // Warm up the dummy hash computation (first call is slower)
    await request(app)
      .post("/auth/login")
      .send({ email: "warmup@test.com", password: "x" });

    const iterations = 5;
    const timeOf = async (email: string) => {
      const start = performance.now();
      await request(app).post("/auth/login").send({ email, password: "wrong" });
      return performance.now() - start;
    };

    let unknown = 0;
    let known = 0;
    for (let i = 0; i < iterations; i++) {
      unknown += await timeOf(`unknown-${crypto.randomUUID()}@test.com`);
      known += await timeOf("owner@demo.test");
    }
    unknown /= iterations;
    known /= iterations;

    // Within 50ms — allows for CI jitter but catches a missing dummy hash
    // (missing dummy hash: ~5ms unknown vs ~100ms known — a 95ms gap)
    expect(Math.abs(unknown - known)).toBeLessThan(50);
  });

  it("blocks requests to feature routes when mustChangePassword is true", async () => {
    // Force the flag on for the owner
    await db
      .update(users)
      .set({ mustChangePassword: true })
      .where(sql`lower(${users.email}) = 'owner@demo.test'`);

    const raw = await loginAsOwner(app);

    // Mount a feature-like route to hit (use /me as a proxy — we'll test the
    // blocking behavior of a default route, not /me which opts in)
    const res = await request(app)
      .get("/protected") // ← must be a route guarded by requireAuth() (no opt-in)
      .set("Cookie", `session=${raw}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("MUST_CHANGE_PASSWORD");
  });

  it("allows /auth/change-password when mustChangePassword is true", async () => {
    await db
      .update(users)
      .set({ mustChangePassword: true })
      .where(sql`lower(${users.email}) = 'owner@demo.test'`);

    const raw = await loginAsOwner(app);

    const res = await request(app)
      .post("/auth/change-password")
      .set("Cookie", `session=${raw}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: "new-password-1234",
      });

    // Should NOT be blocked by mustChangePassword — it should reach the handler
    // (which may return 200, or a validation error, but not 403 MUST_CHANGE_PASSWORD)
    expect(res.status).not.toBe(403);
    expect(res.body.error?.code).not.toBe("MUST_CHANGE_PASSWORD");
  });

  it("clears mustChangePassword after a successful password change", async () => {
    await db
      .update(users)
      .set({ mustChangePassword: true })
      .where(sql`lower(${users.email}) = 'owner@demo.test'`);

    const raw = await loginAsOwner(app);

    await request(app)
      .post("/auth/change-password")
      .set("Cookie", `session=${raw}`)
      .send({
        currentPassword: TEST_PASSWORD,
        newPassword: "new-password-1234",
      });

    // The flag should now be false
    const owner = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'owner@demo.test'`),
    );
    expect(owner.mustChangePassword).toBe(false);

    // And a feature route should now work
    const res = await request(app)
      .get("/protected")
      .set("Cookie", `session=${raw}`);
    expect(res.status).not.toBe(403);
  });

  it("returns 401 and creates no session when the user is suspended", async () => {
    // Suspend the owner
    await db
      .update(users)
      .set({ status: "suspended" })
      .where(sql`lower(${users.email}) = 'owner@demo.test'`);

    const res = await request(app).post("/auth/login").send({
      email: "owner@demo.test",
      password: TEST_PASSWORD,
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(res.headers["set-cookie"]).toBeUndefined(); // ← no cookie

    // No session row created
    const sessionCount = one(
      await db.select({ value: count() }).from(sessions),
    );
    expect(sessionCount.value).toBe(0);

    // No audit row
    const auditCount = one(
      await db
        .select({ value: count() })
        .from(auditLog)
        .where(eq(auditLog.action, "auth.login_succeeded")),
    );
    expect(auditCount.value).toBe(0);
  });

  describe("GET /me", () => {
    it("returns 401 without a cookie", async () => {
      const res = await request(app).get("/me");
      expect(res.status).toBe(401);
    });

    it("returns the authenticated user's identity + permissions", async () => {
      const loginRes = await request(app).post("/auth/login").send({
        email: "owner@demo.test",
        password: TEST_PASSWORD,
      });
      const cookie = loginRes.headers["set-cookie"]![0]!;

      const me = await request(app).get("/me").set("Cookie", cookie);

      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe("owner@demo.test");
      expect(me.body.school.slug).toBe("demo");
      expect(me.body.roles).toContain("owner");
      expect(me.body.permissions).toContain("users:create");
      expect(me.body.mustChangePassword).toBe(false);
    });
  });

  it("stores an argon2 hash (not the raw password) for username-only users", async () => {
    const owner = await loginAsRole(app, "owner");

    const res = await owner.post("/users").send({
      firstName: "Student",
      lastName: "Without",
      username: "jss1-2026-099",
      roleKeys: ["student"],
    });

    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeDefined();

    // The DB stores a hash, not the raw password
    const student = one(
      await db
        .select()
        .from(users)
        .where(
          sql`lower(${users.email}) IS NULL AND ${users.firstName} = 'Student'`,
        ),
    );

    // The stored hash starts with $argon2 (argon2 format marker)
    expect(student.passwordHash).toMatch(/^\$argon2/);

    // The stored hash is NOT the raw password that was returned to the client
    expect(student.passwordHash).not.toBe(res.body.temporaryPassword);
  });

  describe("POST /auth/logout", () => {
    it("revokes the session and clears the cookie", async () => {
      const loginRes = await request(app).post("/auth/login").send({
        email: "owner@demo.test",
        password: TEST_PASSWORD,
      });
      const cookie = loginRes.headers["set-cookie"]![0]!;

      const logout = await request(app)
        .post("/auth/logout")
        .set("Cookie", cookie);
      expect(logout.status).toBe(200);
      // Cookie cleared in Set-Cookie header
      expect(logout.headers["set-cookie"]?.[0]).toMatch(/session=;/);

      // Session is now invalid — /me returns 401 with the (now-dead) cookie
      const me = await request(app).get("/me").set("Cookie", cookie);
      expect(me.status).toBe(401);
    });
  });
});
