import type { Request } from "express";
import type { Actor } from "./can.js";

/**
 * Get the actor from an authenticated request.
 *
 * Throws if requireAuth didn't run — that's a route wiring bug, not a 401.
 * A silent null here would cause the guard to deny with a misleading
 * "forbidden" message that hides the actual problem.
 */
export function actorFromRequest(req: Request): Actor {
  if (!req.actor) {
    throw new Error(
      "actorFromRequest called without requireAuth — check route wiring",
    );
  }
  return req.actor;
}
