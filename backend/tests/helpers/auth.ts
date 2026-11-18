import request from "supertest";
import type { Express } from "express";
import type TestAgent from "supertest/lib/agent.js";
import { apiPath } from "./api.js";

export const TEST_PASSWORD = "test-password-1234";

// ── Email login ───────────────────────────────────────────────────────

/**
 * Log in via email. Returns a supertest agent carrying the session cookie.
 * Throws on non-200 so a broken login fails the calling test loudly instead
 * of producing an agent with no cookie (which then 401s on every subsequent
 * call and confuses the failure message).
 */
export async function loginWithEmail(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<TestAgent> {
  return doLogin(app, { email, password }, `email:${email}`);
}

// ── Username login ────────────────────────────────────────────────────

/**
 * Log in via username + schoolSlug. The usernames are per-school, so the
 * slug disambiguates. Used for the seeded student (`jss1-2026-001`), who
 * has no email.
 */
export async function loginWithUsername(
  app: Express,
  args: { slug: string; username: string; password?: string },
): Promise<TestAgent> {
  return doLogin(
    app,
    {
      username: args.username,
      schoolSlug: args.slug,
      password: args.password ?? TEST_PASSWORD,
    },
    `username:${args.slug}/${args.username}`,
  );
}

// ── Shared internals ──────────────────────────────────────────────────

async function doLogin(
  app: Express,
  body: Record<string, string>,
  identifierLabel: string,
): Promise<TestAgent> {
  const res = await request(app).post(apiPath("/auth/login")).send(body);

  if (res.status !== 200) {
    throw new Error(
      `login failed for ${identifierLabel}: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
  if (!res.headers["set-cookie"]) {
    throw new Error(
      `login succeeded for ${identifierLabel} but no session cookie was set`,
    );
  }

  const agent = request.agent(app);
  agent.jar.setCookie(res.headers["set-cookie"]![0]!);
  return agent;
}

// ── Role-based convenience ────────────────────────────────────────────
//
// Only email-keyed roles go through loginAsRole. The seeded student is
// username-only — they use `loginAsStudent` below, which is the whole
// point of this file change.

export type EmailRole = "owner" | "principal" | "teacher" | "guardian";

/**
 * Log in as a seeded email-keyed role (owner, principal, teacher, guardian).
 * The caller passes just the role; the helper derives the email.
 */
export async function loginAsRole(
  app: Express,
  role: EmailRole,
): Promise<TestAgent> {
  return loginWithEmail(app, `${role}@demo.test`);
}

/**
 * Log in as the seeded student. Username-only — no email exists.
 *
 * The slug is a parameter because `seed()` is what creates the school, and
 * the caller has the seeded result in hand. Pass `seeded.school.slug`.
 */
export async function loginAsStudent(
  app: Express,
  schoolSlug: string,
): Promise<TestAgent> {
  return loginWithUsername(app, {
    slug: schoolSlug,
    username: "jss1-2026-001",
  });
}

// ── Legacy ────────────────────────────────────────────────────────────
// Older call sites use `loginAgent(app, "owner@demo.test")`. Kept so the
// matrix doesn't break wholesale. If you have zero call sites left, delete.

export async function loginAgent(
  app: Express,
  identifier: string | { username: string; schoolSlug: string },
): Promise<TestAgent> {
  if (typeof identifier === "string") {
    return loginWithEmail(app, identifier);
  }
  return loginWithUsername(app, {
    slug: identifier.schoolSlug,
    username: identifier.username,
  });
}

