import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { buildApp } from "../../../src/app.js";
import { db } from "../../../src/db/client.js";
import { memberships, users } from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";
import { seed } from "../../../src/db/seed.js";
import {
  loginAsStudent,
  loginWithUsername,
  TEST_PASSWORD,
} from "../../helpers/auth.js";
import { apiPath } from "../../helpers/api.js";

describe("PATCH /me/username", () => {
  let app: ReturnType<typeof buildApp>;
  let slug: string;

  beforeEach(async () => {
    app = buildApp();
    const seeded = await seed({ password: TEST_PASSWORD });
    slug = seeded.school.slug;
  });

  it("changes the student's username and invalidates the old login", async () => {
    const agent = await loginAsStudent(app, slug);
    const next = `ada.${crypto.randomUUID().slice(0, 8)}`;

    const res = await agent
      .patch(apiPath("/me/username"))
      .send({ currentPassword: TEST_PASSWORD, username: next });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, username: next });

    const withNew = await loginWithUsername(app, {
      slug,
      username: next,
    });
    expect(withNew).toBeTruthy();

    const oldLogin = await request(app)
      .post(apiPath("/auth/login"))
      .send({ username: "jss1-2026-001", schoolSlug: slug, password: TEST_PASSWORD });
    expect(oldLogin.status).toBe(401);
  });

  it("refuses a wrong current password", async () => {
    const agent = await loginAsStudent(app, slug);
    const res = await agent
      .patch(apiPath("/me/username"))
      .send({ currentPassword: "wrong-password", username: "another.name" });
    expect(res.status).toBe(401);
  });

  it("refuses a username that already exists in the school", async () => {
    const teacher = one(await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(users.email, "teacher@demo.test")));
    await db
      .update(memberships)
      .set({ username: "taken.name" })
      .where(eq(memberships.id, teacher.id));

    const agent = await loginAsStudent(app, slug);
    const res = await agent
      .patch(apiPath("/me/username"))
      .send({ currentPassword: TEST_PASSWORD, username: "taken.name" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("USERNAME_TAKEN");
  });
});
