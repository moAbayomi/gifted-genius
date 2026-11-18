// tests/integration/academics/structure-routes.test.ts
//
// HTTP-level coverage for levels and classes: auth, permissions, strict
// validation, response shapes, archive flows, cross-school 404s and the
// route mounts. Service behavior is covered in levels.test.ts / classes.test.ts.
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type express from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { seed } from "../../../src/db/seed.js";
import buildApp from "../../../src/app.js";
import { loginAgent, loginAsRole, TEST_PASSWORD } from "../../helpers/auth.js";
import {
  schools,
  academicSessions,
  levels,
  users,
} from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { apiPath } from "../../helpers/api.js";

type Agent = ReturnType<typeof request.agent>;
type RoleKey = "owner" | "principal" | "teacher" | "guardian" | "student";


describe("structure routes", () => {
  let app: express.Express;
  let school: typeof schools.$inferSelect;
  let session: typeof academicSessions.$inferSelect;
  let jss1: typeof levels.$inferSelect;
  let studentAgent: Agent;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildApp();

    school = one(
      await db.select().from(schools).where(eq(schools.slug, "demo")),
    );
    session = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: school.id, label: "2027/2028" })
        .returning(),
    );
    jss1 = one(
      await db
        .select()
        .from(levels)
        .where(and(eq(levels.schoolId, school.id), eq(levels.name, "JSS 1"))),
    );

    // The seeded student is username-only (email login is not implemented),
    // so give this test copy an email to exercise the student role over HTTP.
    const seededStudent = one(
      await db.select().from(users).where(isNull(users.email)).limit(1),
    );
    await db
      .update(users)
      .set({ email: "route-student@demo.test" })
      .where(eq(users.id, seededStudent.id));
    studentAgent = await loginAgent(app, "route-student@demo.test");
  });

  const agentFor = async (role: RoleKey): Promise<Agent> =>
    role === "student" ? studentAgent : loginAsRole(app, role);

  const createLevel = (
    agent: Agent,
    overrides: Record<string, unknown> = {},
  ) =>
    agent.post(apiPath("/levels")).send({
      name: "Primary 6",
      sequence: 7,
      stage: "junior",
      ...overrides,
    });

  const createClass = (
    agent: Agent,
    overrides: Record<string, unknown> = {},
  ) =>
    agent.post(apiPath("/classes")).send({
      sessionId: session.id,
      levelId: jss1.id,
      armLabel: "A",
      track: "general",
      ...overrides,
    });

  // ── Auth and permissions ─────────────────────────────────────────

  it("returns 401 without a session", async () => {
    const res = await request(app).get(apiPath("/levels"));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("reads levels for roles with academics:read, refuses others", async () => {
    const expected: Record<RoleKey, number> = {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    };

    for (const [role, status] of Object.entries(expected)) {
      const agent = await agentFor(role as RoleKey);
      const res = await agent.get(apiPath("/levels"));
      expect(res.status, `${role} GET /levels`).toBe(status);
    }
  });

  it("refuses writes from teacher, guardian, and student", async () => {
    for (const role of ["teacher", "guardian", "student"] as const) {
      const agent = await agentFor(role);
      const res = await createLevel(agent);
      expect(res.status, `${role} POST /levels`).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("allows owner and principal to create levels", async () => {
    const owner = await loginAsRole(app, "owner");
    const principal = await loginAsRole(app, "principal");

    const first = await createLevel(owner);
    expect(first.status).toBe(201);
    expect(first.body.level).toMatchObject({
      name: "Primary 6",
      sequence: 7,
      stage: "junior",
      archivedAt: null,
    });

    const second = await createLevel(principal, {
      name: "Primary 5",
      sequence: 8,
    });
    expect(second.status).toBe(201);
  });

  it("requires structure:manage to see archived rows", async () => {
    const owner = await loginAsRole(app, "owner");
    const teacher = await loginAsRole(app, "teacher");

    const created = await createLevel(owner);
    expect(created.status).toBe(201);
    const levelId = created.body.level.id as string;

    await owner.post(apiPath(`/levels/${levelId}/archive`)).expect(200);

    const asTeacher = await teacher.get(apiPath("/levels?includeArchived=true"));
    expect(asTeacher.status).toBe(403);

    const asOwner = await owner.get(apiPath("/levels?includeArchived=true"));
    expect(asOwner.status).toBe(200);
    expect(
      asOwner.body.data.some(
        (level: { id: string }) => level.id === levelId,
      ),
    ).toBe(true);
  });

  // ── Level lifecycle and rules ────────────────────────────────────

  it("runs create → list → update → archive → unarchive", async () => {
    const owner = await loginAsRole(app, "owner");

    const created = await createLevel(owner);
    expect(created.status).toBe(201);
    const levelId = created.body.level.id as string;

    const list = await owner.get(apiPath("/levels"));
    expect(list.status).toBe(200);
    expect(list.body.data.map((l: { id: string }) => l.id)).toContain(levelId);

    const updated = await owner
      .patch(apiPath(`/levels/${levelId}`))
      .send({ name: "  Primary 6A  " });
    expect(updated.status).toBe(200);
    expect(updated.body.level.name).toBe("Primary 6A");

    const archived = await owner.post(apiPath(`/levels/${levelId}/archive`));
    expect(archived.status).toBe(200);
    expect(archived.body).toEqual({ ok: true });

    const hidden = await owner.get(apiPath("/levels"));
    expect(hidden.body.data.map((l: { id: string }) => l.id)).not.toContain(
      levelId,
    );

    const visible = await owner.get(apiPath("/levels?includeArchived=true"));
    expect(visible.body.data.map((l: { id: string }) => l.id)).toContain(
      levelId,
    );

    const again = await owner.post(apiPath(`/levels/${levelId}/archive`));
    expect(again.status).toBe(200);

    const unarchived = await owner.post(apiPath(`/levels/${levelId}/unarchive`));
    expect(unarchived.status).toBe(200);
  });

  it("409s on duplicate level name and sequence", async () => {
    const owner = await loginAsRole(app, "owner");
    await createLevel(owner);

    const duplicateName = await createLevel(owner, { sequence: 8 });
    expect(duplicateName.status).toBe(409);
    expect(duplicateName.body.error.code).toBe("LEVEL_NAME_TAKEN");

    const duplicateSequence = await createLevel(owner, { name: "Primary 7" });
    expect(duplicateSequence.status).toBe(409);
    expect(duplicateSequence.body.error.code).toBe("LEVEL_SEQUENCE_TAKEN");
  });

  it("409 LEVEL_ARCHIVED when updating an archived level", async () => {
    const owner = await loginAsRole(app, "owner");
    const created = await createLevel(owner);
    const levelId = created.body.level.id as string;

    await owner.post(apiPath(`/levels/${levelId}/archive`)).expect(200);
    const res = await owner
      .patch(apiPath(`/levels/${levelId}`))
      .send({ name: "Nope" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LEVEL_ARCHIVED");
  });

  it("409 LEVEL_HAS_ACTIVE_CLASSES when a live class references the level", async () => {
    const owner = await loginAsRole(app, "owner");
    const created = await createLevel(owner);
    const levelId = created.body.level.id as string;

    const cls = await createClass(owner, { levelId });
    expect(cls.status).toBe(201);

    const res = await owner.post(apiPath(`/levels/${levelId}/archive`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LEVEL_HAS_ACTIVE_CLASSES");
  });

  // ── Class lifecycle and rules ────────────────────────────────────

  it("reads classes for roles with academics:read, refuses others", async () => {
    const expected: Record<RoleKey, number> = {
      owner: 200,
      principal: 200,
      teacher: 200,
      guardian: 403,
      student: 403,
    };

    for (const [role, status] of Object.entries(expected)) {
      const agent = await agentFor(role as RoleKey);
      const res = await agent.get(apiPath(`/classes?sessionId=${session.id}`));
      expect(res.status, `${role} GET /classes`).toBe(status);
    }
  });

  it("runs create → list → update → archive → unarchive for a class", async () => {
    const owner = await loginAsRole(app, "owner");

    const created = await createClass(owner);
    expect(created.status).toBe(201);
    expect(created.body.class).toMatchObject({
      sessionId: session.id,
      levelId: jss1.id,
      armLabel: "A",
      track: "general",
      archivedAt: null,
      level: { id: jss1.id, name: "JSS 1" },
    });
    const classId = created.body.class.id as string;

    const list = await owner.get(apiPath(`/classes?sessionId=${session.id}`));
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toContain(
      classId,
    );

    const updated = await owner
      .patch(apiPath(`/classes/${classId}`))
      .send({ armLabel: "  B  " });
    expect(updated.status).toBe(200);
    expect(updated.body.class.armLabel).toBe("B");

    await owner.post(apiPath(`/classes/${classId}/archive`)).expect(200);

    const hidden = await owner.get(apiPath(`/classes?sessionId=${session.id}`));
    expect(hidden.body.data.map((c: { id: string }) => c.id)).not.toContain(
      classId,
    );

    const visible = await owner.get(
      apiPath(`/classes?sessionId=${session.id}&includeArchived=true`),
    );
    expect(visible.body.data.map((c: { id: string }) => c.id)).toContain(
      classId,
    );

    await owner.post(apiPath(`/classes/${classId}/unarchive`)).expect(200);
  });

  it("validates class list query and class body", async () => {
    const owner = await loginAsRole(app, "owner");

    expect((await owner.get(apiPath("/classes"))).status).toBe(400);

    const missingSession = await owner.get(apiPath("/classes?bogus=1"));
    expect(missingSession.status).toBe(400);

    const unknownBody = await owner
      .post(apiPath("/classes"))
      .send({
        sessionId: session.id,
        levelId: jss1.id,
        armLabel: "A",
        track: "general",
        schoolId: school.id,
      });
    expect(unknownBody.status).toBe(400);

    const badTrack = await createClass(owner, { track: "science" });
    expect(badTrack.status).toBe(400);
    expect(badTrack.body.error.code).toBe("INVALID_TRACK");
  });

  it("409s on a duplicate class", async () => {
    const owner = await loginAsRole(app, "owner");
    await createClass(owner).expect(201);

    const duplicate = await createClass(owner);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("CLASS_ALREADY_EXISTS");
  });

  it("409 LEVEL_ARCHIVED when creating a class on an archived level", async () => {
    const owner = await loginAsRole(app, "owner");
    const created = await createLevel(owner);
    const levelId = created.body.level.id as string;
    await owner.post(apiPath(`/levels/${levelId}/archive`)).expect(200);

    const res = await createClass(owner, { levelId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LEVEL_ARCHIVED");
  });

  it("409 CLASS_ARCHIVED when updating an archived class", async () => {
    const owner = await loginAsRole(app, "owner");
    const created = await createClass(owner);
    const classId = created.body.class.id as string;
    await owner.post(apiPath(`/classes/${classId}/archive`)).expect(200);

    const res = await owner
      .patch(apiPath(`/classes/${classId}`))
      .send({ armLabel: "B" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CLASS_ARCHIVED");
  });

  // ── Validation and tenancy ───────────────────────────────────────

  it("rejects malformed UUIDs and unknown body fields", async () => {
    const owner = await loginAsRole(app, "owner");

    const badPath = await owner
      .patch(apiPath("/levels/not-a-uuid"))
      .send({ name: "X" });
    expect(badPath.status).toBe(400);

    const badBody = await owner
      .post(apiPath("/levels"))
      .send({ name: "X", sequence: 9, stage: "junior", schoolId: school.id });
    expect(badBody.status).toBe(400);
  });

  it("404s for another school's level and session", async () => {
    const owner = await loginAsRole(app, "owner");
    const otherSchool = one(
      await db
        .insert(schools)
        .values({ name: "Other", slug: "other" })
        .returning(),
    );
    const otherSession = one(
      await db
        .insert(academicSessions)
        .values({ schoolId: otherSchool.id, label: "2026/2027" })
        .returning(),
    );
    const otherLevel = one(
      await db
        .insert(levels)
        .values({
          schoolId: otherSchool.id,
          name: "JSS 1",
          sequence: 1,
          stage: "junior",
        })
        .returning(),
    );

    const levelRes = await owner
      .patch(apiPath(`/levels/${otherLevel.id}`))
      .send({ name: "Nope" });
    expect(levelRes.status).toBe(404);
    expect(levelRes.body.error.code).toBe("LEVEL_NOT_FOUND");

    const sessionRes = await createClass(owner, {
      sessionId: otherSession.id,
    });
    expect(sessionRes.status).toBe(404);
    expect(sessionRes.body.error.code).toBe("SESSION_NOT_FOUND");

    const levelCreateRes = await createClass(owner, {
      levelId: otherLevel.id,
    });
    expect(levelCreateRes.status).toBe(404);
    expect(levelCreateRes.body.error.code).toBe("LEVEL_NOT_FOUND");
  });
});
