// tests/integration/permission-matrix.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { seed } from "../../src/db/seed.js";
import { usersRouter } from "../../src/modules/users/routes.js";
import { rolesRouter } from "../../src/modules/roles/routes.js";
import {authRouter} from "../../src/modules/auth/routes.js";
import { errorHandler } from "../../src/shared/middleware/error-handler.js";
import { loginAgent, TEST_PASSWORD } from "../helpers/auth.js";
import { one } from "../../src/shared/utils/assert.js";
import { memberships, roles } from "../../src/db/schema/index.js";
import {auditRouter} from "../../src/modules/audit/routes.js"

function buildTestApp() {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(authRouter);
  app.use(usersRouter);
  app.use(rolesRouter);
  app.use(auditRouter);
  app.use(errorHandler);
  return app;
}

type RoleKey = "owner" | "principal" | "teacher" | "guardian";

type BuiltRequest = {
  path: string;
  body?: string | object;
};

type Fixtures = {
  /**
   * The STUDENT's membership. Used as the target for every destructive
   * row because:
   *   - Student rank (20) is lower than every test role (25, 50, 80, 100)
   *     → assertCanActOnUser would PASS for all four actors
   *   - No test role is the student
   *     → self-check never fires for any actor
   *   → the permission gate is the SOLE decider for the 403 rows.
   *
   * With teacher as target, teacher rows hit the self-check (teacher is
   * suspending themselves) and guardian rows hit the rank check (25 < 50).
   * Removing requirePermission changed nothing visible — both 403s came
   * from the wrong layer. Student target fixes that.
   */
  studentMembershipId: string;

  /** The STUDENT role at the demo school. Used as the target for
   *  PUT /roles/:id/permissions (rank 20 < every test role's rank). */
  studentRoleId: string;
};

type MatrixRow = {
  name: string;
  method: "get" | "post" | "put" | "delete" | "patch";
  buildRequest: (fixtures: Fixtures) => BuiltRequest;
  expected: Record<RoleKey, number>;
};

const matrix: MatrixRow[] = [
  // ── Read-only ────────────────────────────────────────────────────
  {
    name: "GET /users (list)",
    method: "get",
    buildRequest: () => ({ path: "/users" }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },
  {
    name: "GET /users/:id",
    method: "get",
    buildRequest: (f) => ({ path: `/users/${f.studentMembershipId}` }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },
  {
    name: "GET /roles (list)",
    method: "get",
    buildRequest: () => ({ path: "/roles" }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },

  // ── Create ────────────────────────────────────────────────────────
  {
    name: "POST /users (invite)",
    method: "post",
    buildRequest: () => ({
      path: "/users",
      body: {
        firstName: "Probe",
        lastName: "User",
        email: `probe-${crypto.randomUUID()}@x.test`,
        roleKeys: ["teacher"],
      },
    }),
    expected: { owner: 201, principal: 201, teacher: 403, guardian: 403 },
  },

  // ── Role assignment (non-destructive add) ────────────────────────
  {
    name: "POST /users/:id/roles",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/roles`,
      body: { roleKey: "guardian" },
    }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },

  // ── Destructive: suspend / reactivate / reset ────────────────────
  {
    name: "POST /users/:id/suspend",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/suspend`,
      body: {},
    }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },
  {
    name: "POST /users/:id/reactivate",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/reactivate`,
      body: {},
    }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },
  {
    name: "POST /users/:id/reset-password",
    method: "post",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/reset-password`,
      body: { newPassword: "probe-password-9999" },
    }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },

  // ── Destructive: remove role ─────────────────────────────────────
  {
    name: "DELETE /users/:id/roles/:roleId",
    method: "delete",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}/roles/${f.studentRoleId}`,
    }),
    expected: { owner: 204, principal: 204, teacher: 403, guardian: 403 },
  },

  // ── Edit user ────────────────────────────────────────────────────
  {
    name: "PATCH /users/:id",
    method: "patch",
    buildRequest: (f) => ({
      path: `/users/${f.studentMembershipId}`,
      body: { firstName: "Patched" },
    }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },

  // ── Edit role permissions ────────────────────────────────────────
  {
    name: "PUT /roles/:id/permissions",
    method: "put",
    buildRequest: (f) => ({
      path: `/roles/${f.studentRoleId}/permissions`,
      body: { permissions: ["school:read"] },
    }),
    expected: { owner: 200, principal: 403, teacher: 403, guardian: 403 },
  },
  {
    name: "GET /audit-log",
    method: "get",
    buildRequest: () => ({ path: "/audit-log" }),
    expected: { owner: 200, principal: 200, teacher: 403, guardian: 403 },
  },
];

describe("permission matrix", () => {
  let app: express.Express;
  let fixtures: Fixtures;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildTestApp();

    // Student has a username and no email — look up by username.
    const studentMembership = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.username, "jss1-2026-001")),
    );

    const studentRole = one(
      await db
        .select()
        .from(roles)
        .where(
          and(
            eq(roles.key, "student"),
            eq(roles.schoolId, studentMembership.schoolId),
          ),
        ),
    );

    fixtures = {
      studentMembershipId: studentMembership.id,
      studentRoleId: studentRole.id,
    };
  });

  for (const row of matrix) {
    describe(row.name, () => {
      for (const [role, expectedStatus] of Object.entries(row.expected)) {
        it(`as ${role} → ${expectedStatus}`, async () => {
          const agent = await loginAgent(app, `${role}@demo.test`);
          const req = row.buildRequest(fixtures);
          const res = await agent[row.method](req.path).send(req.body);

          expect(res.status).toBe(expectedStatus);

          // A 403 must be the permission gate — not MUST_CHANGE_PASSWORD,
          // not rate-limited, not any other 403-producing condition.
          // (The target choice above ensures it isn't the self-check or
          // the rank check either. Only the permission gate can produce
          // a 403 for teacher/guardian here.)
          if (expectedStatus === 403) {
            expect(res.body.error.code).toBe("FORBIDDEN");
          }
        });
      }
    });
  }
});
