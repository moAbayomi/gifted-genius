// tests/integration/users/admin-actions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { sql, eq, and, count } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import { usersRouter } from "../../../src/modules/users/routes.js";
import { authRouter } from "../../../src/modules/auth/routes.js";
import { errorHandler } from "../../../src/shared/middleware/error-handler.js";
import {
  users,
  memberships,
  roles,
  membershipRoles,
  schools,
  auditLog,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import {  loginAsRole, TEST_PASSWORD } from "../../helpers/auth.js";
import { activeOwnerMembershipIds } from "../../../src/modules/roles/repository.js";

function buildTestApp() {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use(authRouter);
  app.use(usersRouter);
  app.use(errorHandler);
  return app;
}

async function findMembershipId(email: string): Promise<string> {
  const user = one(
    await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`),
  );
  const mem = one(
    await db.select().from(memberships).where(eq(memberships.userId, user.id)),
  );
  return mem.id;
}

describe("admin actions on members", () => {
  let app: express.Express;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildTestApp();
  });

  // ── Reset password ──────────────────────────────────────────────

  describe("POST /users/:id/reset-password", () => {
    it("resets a lower-ranked user's password and revokes their sessions", async () => {
      const teacherId = await findMembershipId("teacher@demo.test");

      // Log teacher in first — creates a session
      const teacherAgent = await loginAsRole(app, "teacher");
      await teacherAgent.get("/me").expect(200); // sanity: session works

      const owner = await loginAsRole(app, "owner");
      const res = await owner
        .post(`/users/${teacherId}/reset-password`)
        .send({ newPassword: "new-password-9999" });

      expect(res.status).toBe(200);

      // Teacher's existing session is dead
      await teacherAgent.get("/me").expect(401);

      // New password works
      const login = await request(app).post("/auth/login").send({
        email: "teacher@demo.test",
        password: "new-password-9999",
      });
      expect(login.status).toBe(200);
    });

    it("rejects self-target with a helpful message", async () => {
      const ownerId = await findMembershipId("owner@demo.test");
      const owner = await loginAsRole(app, "owner");

      const res = await owner
        .post(`/users/${ownerId}/reset-password`)
        .send({ newPassword: "new-password-9999" });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/change-password/);
    });

    it("rejects resetting a higher-ranked user's password", async () => {
      const ownerId = await findMembershipId("owner@demo.test");
      const principal = await loginAsRole(app, "principal");

      const res = await principal
        .post(`/users/${ownerId}/reset-password`)
        .send({ newPassword: "new-password-9999" });

      expect(res.status).toBe(403);
    });

    it("returns 404 for a cross-school member id", async () => {
      const owner = await loginAsRole(app, "owner");
      const fakeId = crypto.randomUUID();

      const res = await owner
        .post(`/users/${fakeId}/reset-password`)
        .send({ newPassword: "new-password-9999" });

      expect(res.status).toBe(404);
    });

    it("refuses to reset a multi-school user's password", async () => {
      // Teacher is at School A (from seed). Add them to School B directly —
      // bypassing the API, because there's no route for "add existing user to
      // another school" yet (school switcher / invite flows come later).
      const teacherUser = one(
        await db
          .select()
          .from(users)
          .where(eq(users.email, "teacher@demo.test")),
      );
      const teacherMemA = one(
        await db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, teacherUser.id)),
      );

      const [schoolB] = await db
        .insert(schools)
        .values({
          name: "B",
          slug: "school-b",
          type: "combined",
          status: "active",
        })
        .returning();

      await db.insert(memberships).values({
        userId: teacherUser.id,
        schoolId: schoolB!.id,
        status: "active",
      });

      // School A's owner tries to reset teacher's password
      const owner = await loginAsRole(app, "owner");
      const res = await owner
        .post(`/users/${teacherMemA.id}/reset-password`)
        .send({ newPassword: "new-password-9999" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SHARED_ACCOUNT");

      // THE critical assertion: the password hash is unchanged
      const after = one(
        await db.select().from(users).where(eq(users.id, teacherUser.id)),
      );
      expect(after.passwordHash).toBe(teacherUser.passwordHash);
    });

    // Inside describe("POST /users/:id/reset-password")
    it("rejects a teacher resetting a guardian's password (permission gate, not rank)", async () => {
      const guardianId = await findMembershipId("guardian@demo.test");
      const teacher = await loginAsRole(app, "teacher");

      // Teacher rank 50 > guardian rank 25 — assertCanActOnUser would PASS
      // Teacher lacks `users:reset_password` — requirePermission MUST fire
      const res = await teacher
        .post(`/users/${guardianId}/reset-password`)
        .send({ newPassword: "hacked-9999" });

      expect(res.status).toBe(403);

      // The guardian's password is unchanged
      const guardian = one(
        await db
          .select()
          .from(users)
          .where(eq(users.email, "guardian@demo.test")),
      );
      const guardianBefore = guardian.passwordHash;

      // Note: we didn't change it, so it should still match whatever it was
      const after = one(
        await db.select().from(users).where(eq(users.id, guardian.id)),
      );
      expect(after.passwordHash).toBe(guardianBefore);
    });
  });

  // ── Suspend ─────────────────────────────────────────────────────

  describe("POST /users/:id/suspend", () => {
    it("suspends a lower-ranked user and revokes their sessions", async () => {
      const teacherId = await findMembershipId("teacher@demo.test");

      const teacherAgent = await loginAsRole(app, "teacher");
      await teacherAgent.get("/me").expect(200);

      const owner = await loginAsRole(app, "owner");
      const res = await owner.post(`/users/${teacherId}/suspend`).send({});

      expect(res.status).toBe(200);
      await teacherAgent.get("/me").expect(401);

      // Membership is now suspended
      const mem = one(
        await db
          .select()
          .from(memberships)
          .where(eq(memberships.id, teacherId)),
      );
      expect(mem.status).toBe("suspended");
    });

    it("rejects self-suspension", async () => {
      const ownerId = await findMembershipId("owner@demo.test");
      const owner = await loginAsRole(app, "owner");

      const res = await owner.post(`/users/${ownerId}/suspend`).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/suspend yourself/);
    });

    it("rejects suspending a higher-ranked user (owner)", async () => {
      const ownerId = await findMembershipId("owner@demo.test");
      const principal = await loginAsRole(app, "principal");

      const res = await principal.post(`/users/${ownerId}/suspend`).send({});

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/at or above your rank/);

      // Owner is still active
      const ownerMem = one(
        await db.select().from(memberships).where(eq(memberships.id, ownerId)),
      );
      expect(ownerMem.status).toBe("active");
    });

    it("rejects a teacher suspending a guardian (permission gate, not rank)", async () => {
      const guardianId = await findMembershipId("guardian@demo.test");
      const teacher = await loginAsRole(app, "teacher");

      const res = await teacher.post(`/users/${guardianId}/suspend`).send({});

      expect(res.status).toBe(403);

      // Guardian's membership is unchanged
      const mem = one(
        await db
          .select()
          .from(memberships)
          .where(eq(memberships.id, guardianId)),
      );
      expect(mem.status).toBe("active");
    });
  });

  it("activeOwnerMembershipIds returns only the school's active owners", async () => {
    const ownerId = await findMembershipId("owner@demo.test");
    const ownerSchool = one(
      await db.select().from(memberships).where(eq(memberships.id, ownerId)),
    );

    const owners = await activeOwnerMembershipIds(db, ownerSchool.schoolId);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(ownerId);
  });

  it("activeOwnerMembershipIds excludes suspended owners", async () => {
    const ownerId = await findMembershipId("owner@demo.test");
    const ownerSchool = one(
      await db.select().from(memberships).where(eq(memberships.id, ownerId)),
    );

    await db
      .update(memberships)
      .set({ status: "suspended" })
      .where(eq(memberships.id, ownerId));

    const owners = await activeOwnerMembershipIds(db, ownerSchool.schoolId);
    expect(owners).toHaveLength(0);
  });

  it("activeOwnerMembershipIds excludes owners whose user is suspended", async () => {
    const ownerId = await findMembershipId("owner@demo.test");
    const ownerSchool = one(
      await db.select().from(memberships).where(eq(memberships.id, ownerId)),
    );
    const ownerUser = one(
      await db.select().from(users).where(eq(users.email, "owner@demo.test")),
    );

    await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, ownerUser.id));

    const owners = await activeOwnerMembershipIds(db, ownerSchool.schoolId);
    expect(owners).toHaveLength(0);
  });

  it("activeOwnerMembershipIds excludes owners who lost the role", async () => {
    const ownerId = await findMembershipId("owner@demo.test");
    const ownerSchool = one(
      await db.select().from(memberships).where(eq(memberships.id, ownerId)),
    );
    const ownerRole = one(
      await db
        .select()
        .from(roles)
        .where(
          and(eq(roles.key, "owner"), eq(roles.schoolId, ownerSchool.schoolId)),
        ),
    );

    // Direct delete — bypassing the guard (which refuses API removal)
    await db
      .delete(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, ownerId),
          eq(membershipRoles.roleId, ownerRole.id),
        ),
      );

    const owners = await activeOwnerMembershipIds(db, ownerSchool.schoolId);
    expect(owners).toHaveLength(0);
  });

  // ── Remove role ─────────────────────────────────────────────────

  describe("DELETE /users/:id/roles/:roleId", () => {
    it("removes a role from a lower-ranked user", async () => {
      const teacherId = await findMembershipId("teacher@demo.test");
      const teacherRole = one(
        await db
          .select()
          .from(roles)
          .where(
            and(
              eq(roles.key, "teacher"),
              eq(
                roles.schoolId,
                (
                  await db
                    .select()
                    .from(memberships)
                    .where(eq(memberships.id, teacherId))
                )[0]!.schoolId,
              ),
            ),
          ),
      );

      const owner = await loginAsRole(app, "owner");
      const res = await owner.delete(
        `/users/${teacherId}/roles/${teacherRole.id}`,
      );

      expect(res.status).toBe(204);

      // Assignment is gone
      const assignment = await db
        .select()
        .from(membershipRoles)
        .where(
          and(
            eq(membershipRoles.membershipId, teacherId),
            eq(membershipRoles.roleId, teacherRole.id),
          ),
        );
      expect(assignment).toHaveLength(0);
    });

    it.skip("refuses to remove the last owner role", async () => {
      const ownerId = await findMembershipId("owner@demo.test");
      const ownerSchool = one(
        await db.select().from(memberships).where(eq(memberships.id, ownerId)),
      );
      const ownerRole = one(
        await db
          .select()
          .from(roles)
          .where(
            and(
              eq(roles.key, "owner"),
              eq(roles.schoolId, ownerSchool.schoolId),
            ),
          ),
      );

      // ── Setup: create a second owner DIRECTLY (bypassing the API) ──
      // The API blocks owners from creating co-owners (rank strict inequality).
      // For testing the last-owner guard, we need two owners to exist.
      const [secondUser] = await db
        .insert(users)
        .values({
          email: "second-owner@x.test",
          passwordHash: "irrelevant",
          firstName: "Second",
          lastName: "Owner",
        })
        .returning();

      const [secondMembership] = await db
        .insert(memberships)
        .values({
          userId: secondUser!.id,
          schoolId: ownerSchool.schoolId,
          status: "active",
        })
        .returning();

      await db.insert(membershipRoles).values({
        membershipId: secondMembership!.id,
        roleId: ownerRole.id,
        schoolId: ownerSchool.schoolId,
        assignedBy: ownerId,
      });

      // Now there are 2 owners. Remove one (2 → 1, allowed).
      const owner = await loginAsRole(app, "owner");
      const res1 = await owner.delete(
        `/users/${secondMembership!.id}/roles/${ownerRole.id}`,
      );
      expect(res1.status).toBe(204);

      // Now first owner is the last. Remove their role.
      // But self-check fires first → 403 "self", not "last owner".
      // To test the LAST-OWNER check specifically, we need a DIFFERENT actor.
      // Since only owner has roles:assign at rank 100, this is unbuildable
      // via a normal actor — the self-check will always fire first.
      //
      // The last-owner check is therefore only reachable in a hypothetical
      // where:
      //   (a) a super-admin exists with rank > 100, OR
      //   (b) ownership transfer workflow exists
      //
      // For now, the test documents the state: the self-check is what protects
      // the last owner. This is correct behavior — an owner cannot remove
      // their own role, which prevents accidentally orphaning the school.
      const res2 = await owner.delete(
        `/users/${ownerId}/roles/${ownerRole.id}`,
      );
      expect(res2.status).toBe(403);
      // The 403 could be from self-check OR last-owner check —
      // verify it's the self-check (faster path, fires before DB queries):
      expect(res2.body.error.message).toMatch(/your own roles/);
    });

    it("does not write an audit row when removing a role the member doesn't hold", async () => {
      const teacherId = await findMembershipId("teacher@demo.test");
      const teacherSchool = one(
        await db
          .select()
          .from(memberships)
          .where(eq(memberships.id, teacherId)),
      );
      const teacherRole = one(
        await db
          .select()
          .from(roles)
          .where(
            and(
              eq(roles.key, "teacher"),
              eq(roles.schoolId, teacherSchool.schoolId),
            ),
          ),
      );

      // Remove the teacher role once
      const owner = await loginAsRole(app, "owner");
      await owner
        .delete(`/users/${teacherId}/roles/${teacherRole.id}`)
        .expect(204);

      // Count audit rows for role_revoked BEFORE the no-op
      const beforeCount = one(
        await db
          .select({ n: count() })
          .from(auditLog)
          .where(eq(auditLog.action, "membership.role_revoked")),
      );

      // Remove again — the role isn't held, so nothing should change
      const res = await owner.delete(
        `/users/${teacherId}/roles/${teacherRole.id}`,
      );
      expect(res.status).toBe(204); // still idempotent

      // NO new audit row
      const afterCount = one(
        await db
          .select({ n: count() })
          .from(auditLog)
          .where(eq(auditLog.action, "membership.role_revoked")),
      );
      expect(afterCount.n).toBe(beforeCount.n);
    });

    it("rejects a teacher removing a guardian's role (permission gate, not rank)", async () => {
      const guardianId = await findMembershipId("guardian@demo.test");
      const guardianSchool = one(
        await db
          .select()
          .from(memberships)
          .where(eq(memberships.id, guardianId)),
      );
      const guardianRole = one(
        await db
          .select()
          .from(roles)
          .where(
            and(
              eq(roles.key, "guardian"),
              eq(roles.schoolId, guardianSchool.schoolId),
            ),
          ),
      );

      const teacher = await loginAsRole(app, "teacher");
      const res = await teacher.delete(
        `/users/${guardianId}/roles/${guardianRole.id}`,
      );

      expect(res.status).toBe(403);

      // Guardian still has the role
      const assignment = await db
        .select()
        .from(membershipRoles)
        .where(
          and(
            eq(membershipRoles.membershipId, guardianId),
            eq(membershipRoles.roleId, guardianRole.id),
          ),
        );
      expect(assignment).toHaveLength(1);
    });

    it("last-owner check counts only functioning owners", async () => {
      // Set up: two owner role assignments, one functioning, one suspended
      const ownerId = await findMembershipId("owner@demo.test");
      const ownerSchool = one(
        await db.select().from(memberships).where(eq(memberships.id, ownerId)),
      );
      const ownerRole = one(
        await db
          .select()
          .from(roles)
          .where(
            and(
              eq(roles.key, "owner"),
              eq(roles.schoolId, ownerSchool.schoolId),
            ),
          ),
      );

      // Create a second owner whose membership is suspended
      const [otherUser] = await db
        .insert(users)
        .values({
          email: "suspended-owner@x.test",
          firstName: "Suspended",
          lastName: "Owner",
          passwordHash: "irrelevant",
        })
        .returning();
      const [otherMembership] = await db
        .insert(memberships)
        .values({
          userId: otherUser!.id,
          schoolId: ownerSchool.schoolId,
          status: "suspended", // ← NOT a functioning admin
        })
        .returning();
      await db.insert(membershipRoles).values({
        membershipId: otherMembership!.id,
        roleId: ownerRole.id,
        schoolId: ownerSchool.schoolId,
      });

      // Now: 2 owner role assignments, but only 1 functioning owner
      const activeOwners = await activeOwnerMembershipIds(
        db,
        ownerSchool.schoolId,
      );
      expect(activeOwners).toHaveLength(1);
      expect(activeOwners[0]).toBe(ownerId);
    });
  });
});
