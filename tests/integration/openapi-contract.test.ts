// tests/integration/openapi-contract.test.ts
//
// Proves that the documented response schemas match what the API actually
// returns. If a route's shape changes without the docs following, a parse here
// fails. Requires the test database (the normal Vitest global setup).
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type express from "express";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { seed } from "../../src/db/seed.js";
import buildApp from "../../src/app.js";
import { loginAsRole, TEST_PASSWORD } from "../helpers/auth.js";
import { errorResponseSchema } from "../../src/openapi/registry.js";
import {
  loginResponseSchema,
  meResponseSchema,
} from "../../src/modules/auth/schema.js";
import {
  memberDtoSchema,
  memberListResponseSchema,
} from "../../src/modules/users/openapi.js";
import { roleListResponseSchema } from "../../src/modules/roles/openapi.js";
import { auditListResponseSchema } from "../../src/modules/audit/openapi.js";

describe("documented response schemas match real responses", () => {
  let app: express.Express;

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);
    await seed({ password: TEST_PASSWORD });
    app = buildApp();
  });

  it("POST /auth/login", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "owner@demo.test", password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(loginResponseSchema.parse(res.body)).toMatchObject({
      kind: "success",
    });
  });

  it("GET /me", async () => {
    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/me");

    expect(res.status).toBe(200);
    expect(meResponseSchema.parse(res.body).roles).toContain("owner");
  });

  it("GET /users and GET /users/:id", async () => {
    const owner = await loginAsRole(app, "owner");
    const list = await owner.get("/users");

    expect(list.status).toBe(200);
    const parsed = memberListResponseSchema.parse(list.body);
    expect(parsed.data.length).toBeGreaterThan(0);

    const first = parsed.data[0]!;
    const one = await owner.get(`/users/${first.id}`);
    expect(one.status).toBe(200);
    expect(memberDtoSchema.parse(one.body).id).toBe(first.id);
  });

  it("GET /roles", async () => {
    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/roles");

    expect(res.status).toBe(200);
    const parsed = roleListResponseSchema.parse(res.body);
    expect(parsed.data.map((role) => role.key).sort()).toEqual([
      "guardian",
      "owner",
      "principal",
      "student",
      "teacher",
    ]);
  });

  it("GET /audit-log", async () => {
    const owner = await loginAsRole(app, "owner");
    const res = await owner.get("/audit-log");

    expect(res.status).toBe(200);
    const parsed = auditListResponseSchema.parse(res.body);
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it("error responses use the documented envelope", async () => {
    const res = await request(app).get("/me");

    expect(res.status).toBe(401);
    expect(errorResponseSchema.parse(res.body).error.code).toBe(
      "UNAUTHENTICATED",
    );
  });
});
