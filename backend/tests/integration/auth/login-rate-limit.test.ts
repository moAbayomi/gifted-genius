// tests/integration/auth/login-rate-limit.test.ts
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import rateLimit from "express-rate-limit";

/**
 * A minimal app for testing rate-limit behavior in isolation.
 * No DB, no real login route, no authRouter — just a fake login handler
 * that returns 200 for "correct" and 401 for anything else, behind a
 * fresh rate limiter per test.
 *
 * Why isolated: the production login route uses the real limiter, which
 * is skipped in test mode (see login-rate-limit.ts). Testing the limiter
 * through the real route wouldn't work — the limiter is off there. Testing
 * it here with its own real limiter proves the middleware behavior without
 * DB noise or cross-test state bleed.
 */
function buildRateLimitedApp() {
  const app = express();
  app.use(express.json());

  const limiter = rateLimit({
    windowMs: 60 * 1000, // shorter window for tests
    max: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
      error: { code: "RATE_LIMITED", message: "Too many login attempts." },
    },
    skipSuccessfulRequests: true,
  });

  app.post("/auth/login", limiter, (req, res) => {
    if (req.body?.password === "correct") {
      return res.status(200).json({ ok: true });
    }
    res.status(401).json({
      error: {
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      },
    });
  });

  return app;
}

describe("login rate limiting", () => {
  it("allows 5 failed attempts, then 429 on the 6th", async () => {
    const app = buildRateLimitedApp();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "x@test.com", password: "wrong" });
      expect(res.status).toBe(401);
    }

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "x@test.com", password: "wrong" });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("does not count successful logins toward the limit", async () => {
    const app = buildRateLimitedApp();

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "x@test.com", password: "correct" });
      expect(res.status).toBe(200);
    }

    // 6th success — still 200, because successes don't count
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "x@test.com", password: "correct" });
    expect(res.status).toBe(200);
  });

  it("starts with a fresh budget per test (fresh limiter)", async () => {
    // Burn the budget in a first app
    let app = buildRateLimitedApp();
    for (let i = 0; i < 6; i++) {
      await request(app).post("/auth/login").send({ password: "wrong" });
    }
    const exhausted = await request(app)
      .post("/auth/login")
      .send({ password: "wrong" });
    expect(exhausted.status).toBe(429);

    // Fresh app = fresh limiter = fresh budget
    app = buildRateLimitedApp();
    const fresh = await request(app)
      .post("/auth/login")
      .send({ password: "wrong" });
    expect(fresh.status).toBe(401); // not 429
  });
});
