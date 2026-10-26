import { Router, type Request} from "express";
import { db } from "../../db/client.js";
import { requireAuth } from "../auth/middleware/require-auth.js";
import { requirePermission } from "../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../rbac/actor-from-request.js";
import { AppError } from "../../shared/lib/errors.js";
import { parsePageQuery, toPaginatedDto } from "../../shared/dto/pagination.js";
import {
  createUser,
  listUsers,
  resetUserPassword,
  suspendUser,
  removeRoleFromMembership,
  reactivateUser,
  updateUser,
} from "./service.js";
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
} from "./schema.js";
import { toMemberDto, toCreateUserResponseDto } from "./dto.js";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../../shared/utils/password.js";
import { findMember } from "./repository.js";

const router = Router();

/**
 * Extract a required path param, throwing 400 if missing/empty.
 * Express 5 + strict TS can widen `req.params.x` to `string | undefined`;
 * this narrows it safely and gives a clear error if the route is wired wrong.
 */
function pathParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", `Missing path param '${name}'`);
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════════
// POST /users — invite a member (create user or link existing)
// ═══════════════════════════════════════════════════════════════════

router.post(
  "/users",
  requireAuth(),
  requirePermission("users:create"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const input = createUserSchema.parse(req.body);

      const temporaryPassword = randomBytes(9).toString("base64url");
      const passwordHash = await hashPassword(temporaryPassword);

      const result = await db.transaction((tx) =>
        createUser(tx, actor, input, { temporaryPassword, passwordHash }),
      );

      res
        .status(201)
        .json(toCreateUserResponseDto(result.member, result.temporaryPassword));
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// GET /users — paginated list of members at this school
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/users",
  requireAuth(),
  requirePermission("users:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);

      // Validate shape first (rejects unknown query params), then clamp
      // (parsePageQuery enforces max=100, non-negative offset, defaults).
      listUsersQuerySchema.parse(req.query);
      const page = parsePageQuery(
        req.query as { limit?: unknown; offset?: unknown },
      );

      const { rows, total } = await listUsers(db, actor, page);

      res.json(
        toPaginatedDto(rows.map(toMemberDto), {
          limit: page.limit,
          offset: page.offset,
          total,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// POST /users/:id/reset-password — admin generates a new password
// ═══════════════════════════════════════════════════════════════════

router.post(
  "/users/:id/reset-password",
  requireAuth(),
  requirePermission("users:reset_password"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const targetMembershipId = pathParam(req, "id");
      const body = resetPasswordSchema.parse(req.body);

      await db.transaction((tx) =>
        resetUserPassword(tx, actor, targetMembershipId, body.newPassword),
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// POST /users/:id/suspend — suspend a member
// ═══════════════════════════════════════════════════════════════════

router.post(
  "/users/:id/suspend",
  requireAuth(),
 requirePermission("users:suspend"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const targetMembershipId = pathParam(req, "id");

      await db.transaction((tx) => suspendUser(tx, actor, targetMembershipId));

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/users/:id/reactivate",
  requireAuth(),
  requirePermission("users:suspend"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const targetMembershipId = pathParam(req, "id");
      await db.transaction((tx) =>
        reactivateUser(tx, actor, targetMembershipId),
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// DELETE /users/:id/roles/:roleId — remove a specific role from a member
// ═══════════════════════════════════════════════════════════════════

router.delete(
  "/users/:id/roles/:roleId",
  requireAuth(),
  requirePermission("roles:assign"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const targetMembershipId = pathParam(req, "id");
      const roleId = pathParam(req, "roleId");

      await db.transaction((tx) =>
        removeRoleFromMembership(tx, actor, targetMembershipId, roleId),
      );

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/users/:id",
  requireAuth(),
  requirePermission("users:update"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const targetMembershipId = pathParam(req, "id");
      const input = updateUserSchema.parse(req.body);

      const member = await db.transaction((tx) =>
        updateUser(tx, actor, targetMembershipId, input),
      );

      res.json(toMemberDto(member));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/users/:id",
  requireAuth(),
  requirePermission("users:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const id = pathParam(req, "id");
      const member = await findMember(db, actor.schoolId, id);
      if (!member)
        return next(new AppError(404, "NOT_FOUND", "Member not found"));
      res.json(toMemberDto(member));
    } catch (err) {
      next(err);
    }
  },
);

export { router as usersRouter };
