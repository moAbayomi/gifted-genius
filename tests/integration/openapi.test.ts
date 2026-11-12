// tests/integration/openapi.test.ts
//
// Documentation integrity without a database:
//   1. the generated document contains exactly the routes the app exposes;
//   2. /openapi.json and /docs are actually served;
//   3. the CSP is relaxed for /docs only.
//
// The DB-backed proof that response schemas match real responses lives in
// openapi-contract.test.ts, so this file can run without Docker.
import { describe, it, expect } from "vitest";
import request from "supertest";
import buildApp from "../../src/app.js";
import { buildOpenApiDocument } from "../../src/openapi/document.js";

/** Every route the app mounts, as OpenAPI path items. */
const EXPECTED_PATHS = [
  "/health",
  "/auth/login",
  "/auth/logout",
  "/auth/change-password",
  "/me",
  "/users",
  "/users/{id}",
  "/users/{id}/reset-password",
  "/users/{id}/suspend",
  "/users/{id}/reactivate",
  "/users/{id}/roles",
  "/users/{id}/roles/{roleId}",
  "/roles",
  "/roles/{id}/permissions",
  "/audit-log",
  "/terms/{termId}/activate",
  "/terms/{termId}/close",
  "/sessions/{sessionId}/lock",
  "/sessions/{sessionId}/unlock",
  "/levels",
  "/levels/{id}",
  "/levels/{id}/archive",
  "/levels/{id}/unarchive",
  "/classes",
  "/classes/{id}",
  "/classes/{id}/archive",
  "/classes/{id}/unarchive",
  "/classes/clone",
  "/sessions",
  "/sessions/current",
  "/sessions/{id}",
  "/sessions/{id}/rollover",
  "/students",
  "/terms",
  "/terms/{termId}",
  "/subjects",
  "/subjects/{id}",
  "/subjects/{id}/archive",
  "/elective-groups",
  "/elective-groups/{id}",
  "/elective-groups/{id}/archive",
  "/classes/{classId}/offerings",
  "/offerings/{id}",
  "/enrollments",
  "/enrollments/bulk",
  "/enrollments/{id}/electives",
  "/enrollments/{id}/transfer",
  "/enrollments/{id}/withdraw",
  "/classes/{classId}/roster",
].sort();

describe("OpenAPI document", () => {
  const document = buildOpenApiDocument();

  it("is an OpenAPI 3.1 document with exactly the mounted paths", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths ?? {}).sort()).toEqual(EXPECTED_PATHS);
  });

  it("declares the session cookie security scheme", () => {
    expect(document.components?.securitySchemes?.session).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "session",
    });
  });

  it("marks protected operations with the session scheme", () => {
    for (const [path, method] of [
      ["/me", "get"],
      ["/users", "get"],
      ["/audit-log", "get"],
    ] as const) {
      const operation = (document.paths?.[path] as Record<string, unknown>)?.[
        method
      ] as { security?: unknown };
      expect(operation?.security).toEqual([{ session: [] }]);
    }
  });

  it("documents bodies, params, and the standard error envelope", () => {
    expect(document.paths?.["/users"]?.post?.requestBody).toBeDefined();
    expect(document.paths?.["/users/{id}"]?.get?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path" }),
      ]),
    );
    expect(document.components?.schemas?.ErrorResponse).toBeDefined();
    expect(
      document.paths?.["/users/{id}"]?.get?.responses?.["404"],
    ).toBeDefined();
  });
});

describe("docs routes", () => {
  const app = buildApp();

  it("serves the generated spec at /openapi.json", async () => {
    const res = await request(app).get("/openapi.json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body.paths).sort()).toEqual(EXPECTED_PATHS);
  });

  it("serves Swagger UI at /docs", async () => {
    const res = await request(app).get("/docs/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("swagger-ui");
  });

  it("relaxes CSP for /docs only", async () => {
    const docs = await request(app).get("/docs/");
    const health = await request(app).get("/health");

    const docsCsp = String(docs.headers["content-security-policy"] ?? "");
    const healthCsp = String(health.headers["content-security-policy"] ?? "");

    // Swagger UI's inline bootstrap needs unsafe-inline scripts.
    expect(docsCsp).toMatch(/script-src[^;]*'unsafe-inline'/);
    // Every other route keeps helmet's default (no unsafe-inline scripts).
    expect(healthCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});
