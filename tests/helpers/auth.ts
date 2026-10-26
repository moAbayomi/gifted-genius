// tests/helpers/auth.ts
import request from "supertest";
import type express from "express";

export const TEST_PASSWORD = "test-password-1234";

/**
 * Log in via the real /auth/login endpoint, return a supertest agent
 * with the session cookie. The agent persists cookies across requests.
 */
export async function loginAgent(
  app: express.Express,
  email: string,
  password = TEST_PASSWORD,
) {
  const agent = request.agent(app);
  const res = await agent.post("/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(
      `login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  return agent;
}

/**
 * Login as one of the seeded demo users.
 * Uses the seed's role-named emails: owner@, principal@, teacher@, guardian@.
 */
export async function loginAsRole(
  app: express.Express,
  role: "owner" | "principal" | "teacher" | "guardian",
) {
  return loginAgent(app, `${role}@demo.test`);
}