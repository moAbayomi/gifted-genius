import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import type express from "express";
import buildApp from "../../src/app.js";
import { buildOpenApiDocument } from "../../src/openapi/document.js";
import { apiPath } from "../helpers/api.js";

const PUBLIC_PATHS = new Set(["/auth/login", "/health"]);

describe("OpenAPI smoke — every documented path is mounted and protected", () => {
  let app: express.Express;
  beforeEach(() => {
    app = buildApp();
  });

  it("returns 401, never 404, for every documented protected operation", async () => {
    const doc = buildOpenApiDocument();
    const paths = Object.entries(doc.paths ?? {});
    for (const [path, operations] of paths) {
      if (PUBLIC_PATHS.has(path)) continue;
      const concrete = path.replace(/\{[^}]+\}/g, "00000000-0000-4000-8000-000000000000");
      for (const [method, operation] of Object.entries(
        (operations ?? {}) as Record<string, unknown>,
      )) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        const res = await (request(app) as unknown as Record<
          string,
          (p: string) => request.Test
        >)[method]!(apiPath(concrete));
        expect(
          res.status,
          `${method.toUpperCase()} ${apiPath(path)} ${JSON.stringify(operation)}`,
        ).toBe(401);
      }
    }
  });
});
