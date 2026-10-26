// tests/integration/users/create-user.test.ts
import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import express from "express";
import cookieParser from "cookie-parser";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import { usersRouter } from "../../../src/modules/users/routes.js";
import {authRouter} from "../../../src/modules/auth/routes.js";
import { errorHandler } from "../../../src/shared/middleware/error-handler.js";
import {
  users,
  memberships,
  membershipRoles,
  roles,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { loginAsRole, TEST_PASSWORD } from "../../helpers/auth.js";

function buildTestApp() {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(authRouter);
  app.use(usersRouter);
  app.use(errorHandler);
  return app;
}

describe("POST /users", () => {
  let app: express.Express;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildTestApp();
  });

  // ── Happy path: new user with email ─────────────────────────────

  it("creates a new user and returns a temp password", async () => {
    const owner = await loginAsRole(app, "owner");

    const res = await owner.post("/users").send({
      firstName: "Chidi",
      lastName: "Okafor",
      email: "chidi@example.com",
      roleKeys: ["teacher"],
    });

    expect(res.status).toBe(201);
    expect(res.body.user.firstName).toBe("Chidi");
    expect(res.body.user.roles).toEqual(["teacher"]);
    expect(res.body.temporaryPassword).toBeDefined();
    expect(res.body.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{12}$/);

    // Verify user row exists
    const created = one(
      await db.select().from(users).where(eq(users.email, "chidi@example.com")),
    );
    expect(created.mustChangePassword).toBe(true);

    const loginRes = await request(app).post("/auth/login").send({
      email: "chidi@example.com",
      password: res.body.temporaryPassword,
    });
    expect(loginRes.status).toBe(200);
  });

  // ── Happy path: existing user at another school ─────────────────

  it("links an existing user to this school without a temp password", async () => {
    // Create a user at another school first
    const { createSchoolWithDefaults } =
      await import("../../../src/modules/schools/service.js");
    const [otherOwner] = await db
      .insert(users)
      .values({
        email: "other-owner@x.test",
        passwordHash: "does-not-matter",
        firstName: "Other",
        lastName: "Owner",
      })
      .returning();

    await createSchoolWithDefaults(
      {
        name: "Other School",
        slug: "other-school",
        ownerUserId: otherOwner!.id,
      },
      { via: "test" },
    );

    // Now the owner of the demo school invites the same person
    const owner = await loginAsRole(app, "owner");
    const res = await owner.post("/users").send({
      firstName: "Other",
      lastName: "Owner",
      email: "other-owner@x.test",
      roleKeys: ["teacher"],
    });

    expect(res.status).toBe(201);
    expect(res.body.temporaryPassword).toBeUndefined(); // key absent, not null
    expect(res.body.user.roles).toEqual(["teacher"]);

    // Verify only ONE user row exists for that email (no duplicate created)
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, "other-owner@x.test"));
    expect(rows).toHaveLength(1);

    // Verify TWO memberships exist for that user (one per school)
    const mems = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, rows[0]!.id));
    expect(mems).toHaveLength(2);
  });

  // ── Escalation: principal can't invite an owner ─────────────────

  it("principal cannot invite an owner (rank too high)", async () => {
    const principal = await loginAsRole(app, "principal");

    const res = await principal.post("/users").send({
      firstName: "Imposter",
      lastName: "Owner",
      email: "imposter@x.test",
      roleKeys: ["owner"],
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");

    // No user was created
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, "imposter@x.test"));
    expect(rows).toHaveLength(0);
  });

  // ── Escalation: peer cannot create peer ─────────────────────────

  it("principal cannot invite another principal (peer rank)", async () => {
    const principal = await loginAsRole(app, "principal");

    const res = await principal.post("/users").send({
      firstName: "Second",
      lastName: "Principal",
      email: "second-principal@x.test",
      roleKeys: ["principal"],
    });

    expect(res.status).toBe(403);
  });

  // ── Unknown role key → 400 ──────────────────────────────────────

  it("rejects an unknown role key with 400", async () => {
    const owner = await loginAsRole(app, "owner");

    const res = await owner.post("/users").send({
      firstName: "X",
      lastName: "Y",
      email: "x@x.test",
      roleKeys: ["wizard"], // not a valid role
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNKNOWN_ROLE");
  });

  // ── Duplicate membership → 409 ──────────────────────────────────

  it("returns 409 when the user is already a member of this school", async () => {
    const owner = await loginAsRole(app, "owner");

    // Invite teacher once
    const first = await owner.post("/users").send({
      firstName: "A",
      lastName: "B",
      email: "a@x.test",
      roleKeys: ["teacher"],
    });
    expect(first.status).toBe(201);

    // Invite again → 409
    const second = await owner.post("/users").send({
      firstName: "A",
      lastName: "B",
      email: "a@x.test",
      roleKeys: ["teacher"],
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ALREADY_MEMBER");
  });

  it("dedupes duplicate roleKeys and creates the user once", async () => {
    const owner = await loginAsRole(app, "owner");
    const res = await owner.post("/users").send({
      firstName: "X",
      lastName: "Y",
      email: "x@x.test",
      roleKeys: ["teacher", "teacher"],   // duplicates — should be deduped
    });
  
    expect(res.status).toBe(201);
  
    // The member has exactly one role assignment, not two
    const member = res.body.user;
    expect(member.roles).toEqual(["teacher"]);
  
    // Verify in DB
    const assignments = await db
      .select({ key: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, member.id));
    expect(assignments).toHaveLength(1);
  });

  // ── Transaction rollback: late failure leaves nothing behind ────

  it("rolls back the user creation when a later step fails", async () => {
    const owner = await loginAsRole(app, "owner");

    // Create a member with username "taken"
    await owner.post("/users").send({
      firstName: "First",
      lastName: "User",
      email: "first@x.test",
      username: "taken-username",
      roleKeys: ["teacher"],
    });

    // Try to create another user with a DIFFERENT email but the SAME username
    // Steps 1-3 succeed (user row for second@x.test created)
    // Step 4 fails on memberships_school_username_uq
    // Transaction rolls back → the user row for second@x.test must NOT exist
    const res = await owner.post("/users").send({
      firstName: "Second",
      lastName: "User",
      email: "second@x.test",
      username: "taken-username",
      roleKeys: ["teacher"],
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USERNAME_TAKEN");

    // ← The critical assertion: no orphaned user row from the failed attempt
    const orphaned = await db
      .select()
      .from(users)
      .where(eq(users.email, "second@x.test"));
    expect(orphaned).toHaveLength(0);
  });

  // ── New user gets mustChangePassword: true ─────────────────────

  it("new user must change password on first login", async () => {
    const owner = await loginAsRole(app, "owner");

    const createRes = await owner.post("/users").send({
      firstName: "New",
      lastName: "User",
      email: "new@x.test",
      roleKeys: ["teacher"],
    });

    const request = (await import("supertest")).default;
    const loginRes = await request(app).post("/auth/login").send({
      email: "new@x.test",
      password: createRes.body.temporaryPassword,
    });
    expect(loginRes.status).toBe(200);

    const cookie = loginRes.headers["set-cookie"]![0]!.split(";")[0]!;
    const meRes = await request(app).get("/me").set("Cookie", cookie);
    expect(meRes.body.mustChangePassword).toBe(true);
  });

  // tests/integration/users/create-user.test.ts — inside describe("POST /users")
  it("returns 401 without a session", async () => {
    const res = await request(app)
      .post("/users")
      .send({
        firstName: "X",
        lastName: "Y",
        email: "x@x.test",
        roleKeys: ["teacher"],
      });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  // tests/integration/users/create-user.test.ts — inside describe("POST /users")
  it("rejects unexpected fields in the body (mass assignment)", async () => {
    const owner = await loginAsRole(app, "owner");

    const res = await owner.post("/users").send({
      firstName: "X",
      lastName: "Y",
      email: "x@x.test",
      roleKeys: ["teacher"],
      // Fields the client is trying to inject — NOT in the schema
      status: "active", // can't force a status
      schoolId: "other-uuid", // can't create users at another school
      mustChangePassword: false, // can't skip the password-change flow
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    // Critical: nothing was created despite the extra fields
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, "x@x.test"));
    expect(rows).toHaveLength(0);
  });
});
