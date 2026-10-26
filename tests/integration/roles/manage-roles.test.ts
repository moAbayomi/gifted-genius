// tests/integration/roles/manage-roles.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import { usersRouter } from "../../../src/modules/users/routes.js";
import { rolesRouter } from "../../../src/modules/roles/routes.js";
import  {authRouter} from "../../../src/modules/auth/routes.js";
import { errorHandler } from "../../../src/shared/middleware/error-handler.js";
import {
  users,
  memberships,
  roles,
  rolePermissions,
  membershipRoles,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { loginAsRole, TEST_PASSWORD } from "../../helpers/auth.js";

function buildTestApp() {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(authRouter);
  app.use(usersRouter);
  app.use(rolesRouter);
  app.use(errorHandler);
  return app;
}

async function findRoleByKey(key: string) {
  const teacherUser = one(
    await db.select().from(users).where(eq(users.email, "teacher@demo.test")),
  );
  const mem = one(
    await db.select().from(memberships).where(eq(memberships.userId, teacherUser.id)),
  );
  return one(
    await db.select().from(roles).where(
      and(eq(roles.key, key), eq(roles.schoolId, mem.schoolId)),
    ),
  );
}

async function grantManagePermissionsToPrincipal(): Promise<typeof roles.$inferSelect> {
  const principalRole = await findRoleByKey("principal");
  await db
    .insert(rolePermissions)
    .values({ roleId: principalRole.id, permission: "roles:manage_permissions" });
  return principalRole;
}

describe("roles management", () => {
  let app: express.Express;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildTestApp();
  });

  // ── GET /roles ──────────────────────────────────────────────────

  it("lists the 5 system roles for the actor's school", async () => {
    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/roles");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    const keys = res.body.data.map((r: any) => r.key).sort();
    expect(keys).toEqual(["guardian", "owner", "principal", "student", "teacher"]);
  });

  // ── POST /users/:id/roles (assignRole) ──────────────────────────

  it("owner assigns the guardian role to a teacher (multi-role)", async () => {
    const teacherUser = one(
      await db.select().from(users).where(eq(users.email, "teacher@demo.test")),
    );
    const mem = one(
      await db.select().from(memberships).where(eq(memberships.userId, teacherUser.id)),
    );

    const owner = await loginAsRole(app, "owner");
    const res = await owner
      .post(`/users/${mem.id}/roles`)
      .send({ roleKey: "guardian" });

    expect(res.status).toBe(200);

    // Teacher now has both roles
    const assignments = await db
      .select({ key: roles.key })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .where(eq(membershipRoles.membershipId, mem.id));
    const keys = assignments.map((a) => a.key).sort();
    expect(keys).toEqual(["guardian", "teacher"]);
  });

  it("principal cannot assign a role at their own rank", async () => {
    const teacherUser = one(
      await db.select().from(users).where(eq(users.email, "teacher@demo.test")),
    );
    const mem = one(
      await db.select().from(memberships).where(eq(memberships.userId, teacherUser.id)),
    );

    const principal = await loginAsRole(app, "principal");
    const res = await principal
      .post(`/users/${mem.id}/roles`)
      .send({ roleKey: "principal" });

    expect(res.status).toBe(403);
  });

  // ── PUT /roles/:id/permissions ──────────────────────────────────

  it("owner edits the teacher role's permissions", async () => {
    const teacherRole = await findRoleByKey("teacher");
    const owner = await loginAsRole(app, "owner");

    const res = await owner
      .put(`/roles/${teacherRole.id}/permissions`)
      .send({ permissions: ["school:read", "users:read"] });

    expect(res.status).toBe(200);
    expect(res.body.permissions.sort()).toEqual(["school:read", "users:read"]);

    // Verify in DB
    const perms = await db
      .select({ p: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, teacherRole.id));
    expect(perms.map((p) => p.p).sort()).toEqual(["school:read", "users:read"]);
  });

  it("refuses to edit the owner role's permissions", async () => {
    const ownerRole = await findRoleByKey("owner");
    const owner = await loginAsRole(app, "owner");

    const res = await owner
      .put(`/roles/${ownerRole.id}/permissions`)
      .send({ permissions: ["school:read"] });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/cannot be changed/);
  });

  it("refuses to grant a permission the actor does not hold (subset rule)", async () => {
    // Set up a scenario: principal normally lacks roles:manage_permissions,
    // so can't reach the endpoint. Manually grant it to principal's role,
    // then principal tries to grant school:update (which they don't have).
    const principalRole = await findRoleByKey("principal");

    // Grant roles:manage_permissions to principal role temporarily
    await db
      .insert(rolePermissions)
      .values({ roleId: principalRole.id, permission: "roles:manage_permissions" });

    // Now principal can call the endpoint but lacks school:update
    const principal = await loginAsRole(app, "principal");
    const teacherRole = await findRoleByKey("teacher");

    const res = await principal
      .put(`/roles/${teacherRole.id}/permissions`)
      .send({ permissions: ["school:read", "school:update"] });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/permissions you do not hold/);
  });

  // tests/integration/roles/manage-roles.test.ts
  it("rejects unknown permission strings with 400", async () => {
    const teacherRole = await findRoleByKey("teacher");
    const owner = await loginAsRole(app, "owner");
  
    const res = await owner
      .put(`/roles/${teacherRole.id}/permissions`)
      .send({ permissions: ["school:read", "foo:bar"] });
  
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  
    // THE critical assertion: the role's permissions are unchanged
    const perms = await db
      .select({ p: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, teacherRole.id));
    const permissionStrings = perms.map((p) => p.p).sort();
    expect(permissionStrings).toEqual(["school:read"]);   // original, unchanged
  });

  it("principal cannot edit the owner role (immutability lock, non-owner actor)", async () => {
    // Grant principal `roles:manage_permissions` so they reach the service guard
    await grantManagePermissionsToPrincipal();
  
    const ownerRole = await findRoleByKey("owner");
    const principal = await loginAsRole(app, "principal");
  
    const res = await principal
      .put(`/roles/${ownerRole.id}/permissions`)
      .send({ permissions: ["school:read"] });
  
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/cannot be changed/);
  
    // The lock fires BEFORE the rank check — owner role still intact
    const perms = await db
      .select({ p: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, ownerRole.id));
    expect(perms.length).toBeGreaterThan(5);   // still the full catalogue
  });

  it("principal cannot edit the principal role (peer-rank check)", async () => {
    const principalRole = await grantManagePermissionsToPrincipal();

  
    const principal = await loginAsRole(app, "principal");
    const res = await principal
      .put(`/roles/${principalRole.id}/permissions`)
      .send({ permissions: ["school:read"] });
  
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/ranked below your own/);
  
    // Principal's own role is intact
    const perms = await db
      .select({ p: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, principalRole.id));
    const permissionStrings = perms.map((p) => p.p);
    expect(permissionStrings).toContain("roles:manage_permissions");  // still there
    expect(permissionStrings).toContain("users:read");                 // not stripped
  });

  describe("permission changes take effect immediately", () => {
    it("removing users:read from principal role 403s principal's next request on same cookie", async () => {
      // Phase 1: principal logs in and has users:read
      const principalAgent = await loginAsRole(app, "principal");
      await principalAgent.get("/users").expect(200);
  
      // Phase 2: owner strips users:read from principal role
      const principalRole = await findRoleByKey("principal");
      await db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, principalRole.id),
            eq(rolePermissions.permission, "users:read"),
          ),
        );
  
      // Phase 3: SAME cookie, next request → 403
      const res = await principalAgent.get("/users");
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/users:read/);
    });
  
    it("adding users:read back re-enables principal's next request (no re-login)", async () => {
      // Phase 1: strip users:read, confirm blocked
      const principalRole = await findRoleByKey("principal");
      await db
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, principalRole.id),
            eq(rolePermissions.permission, "users:read"),
          ),
        );
  
      const principalAgent = await loginAsRole(app, "principal");
      await principalAgent.get("/users").expect(403);
  
      // Phase 2: re-add users:read
      await db.insert(rolePermissions).values({
        roleId: principalRole.id,
        permission: "users:read",
      });
  
      // Phase 3: SAME cookie, next request → 200
      await principalAgent.get("/users").expect(200);
    });
  });
});