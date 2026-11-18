import type { CookieOptions } from "express";
import { env } from "../../config/env.js";

/**
 * Options for the session cookie. Centralized so login and logout can't
 * drift. `secure` is production-only — HTTPS-only in prod, works over
 * HTTP in dev.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.APP_STAGE === "production",
    sameSite: "lax",
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
    domain: env.COOKIE_DOMAIN, 
  };
}