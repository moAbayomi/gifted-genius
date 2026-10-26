import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { sql, eq } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { seed } from "../../src/db/seed.js";
import { createSession } from "../../src/modules/auth/session.js";
import { requireAuth } from "../../src/modules/auth/middleware/require-auth.js";
import { requirePermission } from "../../src/modules/rbac/middleware/require-permission.js";
import { memberships } from "../../src/db/schema/index.js";
import { errorHandler } from "../../src/shared/middleware/error-handler.js";
import { users } from "../../src/db/schema/index.js";
import { one } from "../../src/shared/utils/assert.js";

// A minimal app — just enough middleware to exercise requireAuth +
// requirePermission + a protected route + the error handler. No pinoHttp,
// no helmet, no JSON parser — those aren't what this test is about.
function buildMiniApp() {
  const app = express();
  app.use(cookieParser());

  app.get(
    "/protected",
    requireAuth(),
    requirePermission("users:create"),
    (_req, res) => res.json({ ok: true }),
  );

  app.use(errorHandler);
  return app;
}

describe("requireAuth + requirePermission middleware", () => {
  let app: express.Express;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: "test-password-1234" });
    app = buildMiniApp();
  });

  // ── 401: no session ──────────────────────────────────────────────

  it("returns 401 when no session cookie is present", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 when the session cookie is invalid", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Cookie", "session=not-a-real-token");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  // ── 403: valid session, missing permission ──────────────────────

  it("returns 403 when the user lacks the required permission", async () => {
    // Teacher has school:read but not users:create
    const teacher = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'teacher@demo.test'`),
    );
    // Load their membership (the seed creates one; we need the id)
    const teacherMembership = one(
      await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, teacher.id)),
    );

    const token = await createSession(db, teacher.id, teacherMembership.id, {});

    const res = await request(app)
      .get("/protected")
      .set("Cookie", `session=${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toContain("users:create");
  });

  // ── 200: valid session, has permission ──────────────────────────

  it("returns 200 when the user has the required permission", async () => {
    // Principal has users:create
    const principal = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'principal@demo.test'`),
    );
    const principalMembership = one(
      await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, principal.id)),
    );

    const token = await createSession(
      db,
      principal.id,
      principalMembership.id,
      {},
    );

    const res = await request(app)
      .get("/protected")
      .set("Cookie", `session=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
