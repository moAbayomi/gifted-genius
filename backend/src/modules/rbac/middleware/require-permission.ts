// modules/rbac/middleware/require-permission.ts
import type { RequestHandler } from "express";
import { AppError } from "../../../shared/lib/errors.js";
import { can } from "../can.js";
import { actorFromRequest } from "../actor-from-request.js";
import type { Permission } from "../permissions.js";

/**
 * Route guard: require a specific permission.
 *
 * Must be mounted AFTER requireAuth. `requireAuth` populates req.actor;
 * this middleware reads it via `actorFromRequest` (which throws if
 * requireAuth didn't run — a loud failure beats a silent 401).
 *
 * No resource scope here — the middleware runs before the handler loads
 * the target. Resource-scoped `can()` calls happen inside the service,
 * once the target's schoolId is known.
 */
export function requirePermission(perm: Permission): RequestHandler {
  return (req, _res, next) => {
    const actor = actorFromRequest(req);
    if (!can(actor, perm)) {
      return next(
        new AppError(403, "FORBIDDEN", `Missing permission: ${perm}`),
      );
    }
    next();
  };
}
