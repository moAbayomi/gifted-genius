import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";

// ── Key normalization ─────────────────────────────────────────────────

/**
 * Same normalization the Zod login schema applies: trim + lowercase.
 * Returns `undefined` for missing, non-string, or empty-after-trim values,
 * so the caller treats "missing" and "blank" identically.
 *
 * Guards against `body.email` being a non-string (arrays, numbers) so
 * the key generator can never throw on malformed input.
 */
function normalizeKeyPart(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ── Key generator ─────────────────────────────────────────────────────

/**
 * Derive the rate-limit bucket key from the login request body.
 *
 *   username login → "user:<slug>:<username>"
 *   email login    → "email:<slug>:<email>"
 *   neither        → "ip:<ip>"  (fallback — never throw)
 *
 * The "user:" / "email:" / "ip:" prefix keeps buckets disjoint: an
 * attacker typing someone's email as a username lands in a different
 * bucket than the real email login for the same string.
 *
 * Never throws. Malformed bodies (undefined, {}, non-string fields)
 * fall through to the IP key.
 */
export function loginRateLimitKey(req: Request): string {
  // req.body may be undefined if express.json() hasn't run, or the
  // request had no body. Treat as an empty object.
  const body =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : {};

  const schoolSlug = normalizeKeyPart(body.schoolSlug);
  const email = normalizeKeyPart(body.email);
  const username = normalizeKeyPart(body.username);

  // Username login — the brief's primary case.
  if (username !== undefined) {
    // schoolSlug is required for username per the schema, but if it's
    // missing here (malformed body), still produce a stable key — "-"
    // groups "username with no slug" together so it's rate-limited too.
    return `user:${schoolSlug ?? "-"}:${username}`;
  }

  // Email login — includes schoolSlug when present, so multi-school
  // users get one bucket per school (matches the email flow's
  // select_school semantics).
  if (email !== undefined) {
    return `email:${schoolSlug ?? "-"}:${email}`;
  }

  // Fallback: no usable identifier in the body. Use the IP so a client
  // sending garbage gets rate-limited on source instead.
  const ip = ipKeyGenerator(req.ip ?? "");
   
  return `ip:${ip}`;
}

// ── Limiter export ────────────────────────────────────────────────────

/**
 * Rate limiter for POST /auth/login.
 *
 * Disabled under NODE_ENV=test — tests exercise many login attempts
 * per file, and 429s would mask real failures. The dedicated
 * rate-limit test (if/when written) should bypass this skip explicitly
 * (e.g. `vi.stubEnv("NODE_ENV", "production")` in a describe-scoped
 * beforeAll).
 *
 * Keep windowMs / max in sync with the previous IP-based limiter unless
 * a review decides otherwise — this change is about the *key*, not the
 * *rate*.
 */
export const loginRateLimit =
  process.env.NODE_ENV === "test"
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000, // adjust to match your previous config
        max: 10, // adjust to match your previous config
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: loginRateLimitKey,
      });
