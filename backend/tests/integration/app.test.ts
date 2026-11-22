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

  it("returns a 400, not a 500, for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("content-type", "application/json")
      .send('{"email":"owner@giftedmind.test","password":"ownerpass1234",}');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "INVALID_JSON" } });
  });

  it("unknown route returns JSON 404", async () => {
    const res = await request(app).get("/adigun");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
