// modules/auth/middleware/require-auth.ts
import type { RequestHandler } from "express";
import { db } from "../../../db/client.js";
import { AppError } from "../../../shared/lib/errors.js";
import { findLiveSession } from "../repository.js";
import { hashToken } from "../session.js";
import { getPermissionsForMembership } from "../../rbac/get-permissions.js";
import { loadMembershipRank } from "../../rbac/rank.js";

interface RequireAuthOptions {
  /**
   * Allow the request through even when `mustChangePassword` is true.
   *
   * Use ONLY on routes the user must be able to hit before changing their
   * password:
   *   - POST /auth/change-password  (the whole point is to change it)
   *   - POST /auth/logout           (they must be able to sign out)
   *   - GET  /me                    (frontend needs to detect the state)
   *
   * NEVER use on feature routes (students, teachers, admin actions).
   * Default: false (blocks).
   */
  allowMustChangePassword?: boolean;
}

export function requireAuth(opts: RequireAuthOptions = {}): RequestHandler {
  const allowMustChangePassword = opts.allowMustChangePassword ?? false;

  return async (req, _res, next) => {
    try {
      const raw = req.cookies?.session;
      if (!raw) return next(new AppError(401, "UNAUTHENTICATED", "No session"));

      const live = await findLiveSession(db, hashToken(raw));
      if (!live)
        return next(new AppError(401, "UNAUTHENTICATED", "Invalid session"));

      const [permissions, rank] = await Promise.all([
        getPermissionsForMembership(db, live.membershipId),
        loadMembershipRank(db, live.membershipId),
      ]);

      // Populate the request FIRST — the error handler and any downstream
      // logging need `req.actor` even when we're about to reject.
      req.actor = {
        userId: live.userId,
        membershipId: live.membershipId,
        schoolId: live.schoolId,
        rank,
        permissions,
      };
      req.sessionId = live.sessionId;
      req.mustChangePassword = live.mustChangePassword;

      // Block unless the route opted in
      if (live.mustChangePassword && !allowMustChangePassword) {
        return next(
          new AppError(
            403,
            "MUST_CHANGE_PASSWORD",
            "You must change your password before continuing",
          ),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
