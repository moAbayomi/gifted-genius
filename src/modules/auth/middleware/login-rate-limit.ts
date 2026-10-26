import rateLimit from "express-rate-limit";
import env from "../../../config/env.js";

export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP per window
  standardHeaders: "draft-7", // RateLimit-* headers (RFC 9331)
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many login attempts. Try again in 15 minutes.",
    },
  },
  // Skip successful requests — only count failures toward the limit
  // (so a legitimate user who logs in 10 times in a row isn't blocked)
  skipSuccessfulRequests: true,
  skip: () => env.APP_STAGE === "test",
});
