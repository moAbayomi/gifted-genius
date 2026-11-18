import { describe, it, expect } from "vitest";
import request from "supertest";
import buildApp from "../../src/app.js";

describe("app", () => {
  const app = buildApp();

  it("GETs /health and returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("unknown route returns JSON 404", async () => {
    const res = await request(app).get("/adigun");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
