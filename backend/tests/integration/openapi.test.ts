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
import { readFileSync } from "node:fs";
import { buildOpenApiDocument } from "../../src/openapi/document.js";

describe("OpenAPI document", () => {
  const document = buildOpenApiDocument();

  it("is an OpenAPI 3.1 document with exactly the mounted paths", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(Object.keys(document.paths ?? {}).length).toBeGreaterThan(0);
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

  it("gives every JSON response a schema", () => {
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const operation = (item as Record<string, any>)[method];
        if (!operation) continue;
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          const content = (response as any).content?.["application/json"];
          if (content) {
            expect(content.schema, `${method.toUpperCase()} ${path} ${status}`).toBeDefined();
          }
        }
      }
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

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function normalizePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function collectMountedRoutes(app: ReturnType<typeof buildApp>) {
  const routes = new Map<string, Set<string>>();
  const walk = (stack: any[]) => {
    for (const layer of stack) {
      if (layer.route) {
        const rawPath = layer.route.path as string;
        if (
          rawPath.startsWith("/__test") ||
          rawPath === "/openapi.json" ||
          rawPath.startsWith("/docs")
        ) {
          continue;
        }
        const path = normalizePath(rawPath);
        const methods = routes.get(path) ?? new Set<string>();
        for (const method of HTTP_METHODS) {
          if (layer.route.methods?.[method]) methods.add(method);
        }
        routes.set(path, methods);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app as any).router.stack);
  return new Map(
    [...routes.entries()].map(([path, methods]) => [path, [...methods].sort()]),
  );
}

function documentRoutes(document: ReturnType<typeof buildOpenApiDocument>) {
  const routes = new Map<string, string[]>();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    routes.set(
      path,
      HTTP_METHODS.filter((method) => (item as Record<string, unknown>)[method]),
    );
  }
  return routes;
}

describe("mounted routes vs OpenAPI", () => {
  const app = buildApp();
  const document = buildOpenApiDocument();

  it("documents exactly the routes mounted on the app", () => {
    expect(documentRoutes(document)).toEqual(collectMountedRoutes(app));
  });

  it("keeps the committed docs/openapi.json in sync", () => {
    const committed = JSON.parse(
      readFileSync(new URL("../../docs/openapi.json", import.meta.url), "utf8"),
    );
    expect(committed).toEqual(document);
  });
});

describe("docs routes", () => {
  const app = buildApp();
  const document = buildOpenApiDocument();

  it("serves the generated spec at /openapi.json", async () => {
    const res = await request(app).get("/openapi.json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Object.keys(res.body.paths).sort()).toEqual(Object.keys(document.paths ?? {}).sort());
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
