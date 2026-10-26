// modules/auth/routes.ts
import { Router } from "express";
import { db } from "../../db/client.js";
import { requireAuth } from "./middleware/require-auth.js";
import { changePassword } from "./service.js";
import { AppError } from "../../shared/lib/errors.js";
import { login } from "./service.js";
import { sessionCookieOptions } from "./cookies.js";
import { actorFromRequest } from "../rbac/actor-from-request.js";
import { findSchoolById, findUserById } from "./repository.js";
import { getRolesForMembership } from "../rbac/get-roles.js";
import { hashToken } from "./session.js";
import { sessions } from "../../db/schema/sessions.js";
import { eq } from "drizzle-orm";
import { loginRateLimit } from "./middleware/login-rate-limit.js";
import { changePasswordSchema, loginSchema } from "./schema.js";

const router = Router();

router.post(
  "/auth/change-password",
  requireAuth({ allowMustChangePassword: true }),
  async (req, res, next) => {
    try {
      const body = changePasswordSchema.parse(req.body);
      const actor = actorFromRequest(req);

      if (body.currentPassword === body.newPassword) {
        throw new AppError(
          400,
          "SAME_PASSWORD",
          "New password must differ from the current one",
        );
      }

      await db.transaction(async (tx) => {
        await changePassword(
          tx,
          actor,
          req.sessionId!,
          body.currentPassword,
          body.newPassword,
        );
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post("/auth/login", loginRateLimit, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await login(db, body, {
      userAgent: req.get("user-agent"),
      ipAddress: req.ip,
      log: req.log,
    });

    if (result.kind === "select_school") {
      return res.json({
        kind: "select_school",
        schools: result.schools,
      });
    }

    res.cookie("session", result.token, sessionCookieOptions());
    res.json({
      kind: "success",
      user: { id: result.userId },
      school: { id: result.schoolId },
      membership: { id: result.membershipId },
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/auth/logout",
  requireAuth({ allowMustChangePassword: true }),
  async (req, res, next) => {
    try {
      const raw = req.cookies?.session;
      if (raw) {
        const tokenHash = hashToken(raw);
        await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
      }
      res.clearCookie("session", sessionCookieOptions());
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/me",
  requireAuth({ allowMustChangePassword: true }),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);

      const [user, school, roles] = await Promise.all([
        findUserById(db, actor.userId),
        findSchoolById(db, actor.schoolId),
        getRolesForMembership(db, actor.membershipId),
      ]);

      if (!user || !school) {
        // requireAuth already verified session exists — if we get here, DB is inconsistent
        throw new AppError(
          500,
          "INTERNAL",
          "Session points to missing user or school",
        );
      }

      res.json({
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        school: {
          id: school.id,
          name: school.name,
          slug: school.slug,
        },
        roles, // ["owner"], ["teacher", "guardian"], etc.
        permissions: [...actor.permissions], // array, easier for frontend than Set
        mustChangePassword: req.mustChangePassword ?? false,
      });
    } catch (err) {
      next(err);
    }
  },
);

export {router as authRouter} 
