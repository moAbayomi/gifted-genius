// modules/roles/routes.ts
import { Router, type Request } from "express";
import { db } from "../../db/client.js";
import { requireAuth } from "../auth/middleware/require-auth.js";
import { requirePermission } from "../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../rbac/actor-from-request.js";
import { AppError } from "../../shared/lib/errors.js";
import type { Permission } from "../rbac/permissions.js";
import {
  listRoles,
  assignRole,
  updateRolePermissions,
} from "./service.js";
import { toRoleDto, toRoleDetailDto } from "./dto.js";
import {
  assignRoleSchema,
  updateRolePermissionsSchema,
} from "./schema.js";
import { findRolePermissions } from "./repository.js";

const router = Router();

function pathParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new AppError(400, "VALIDATION_ERROR", `Missing path param '${name}'`);
  }
  return v;
}

// ═══════════════════════════════════════════════════════════════════
// GET /roles — list all roles at this school
// ═══════════════════════════════════════════════════════════════════

router.get(
  "/roles",
  requireAuth(),
  requirePermission("roles:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const roles = await listRoles(db, actor);
      res.json({ data: roles.map(toRoleDto) });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// POST /users/:id/roles — assign a role to an existing member
// ═══════════════════════════════════════════════════════════════════

router.post(
  "/users/:id/roles",
  requireAuth(),
  requirePermission("roles:assign"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const targetMembershipId = pathParam(req, "id");
      const body = assignRoleSchema.parse(req.body);

      await db.transaction((tx) =>
        assignRole(tx, actor, targetMembershipId, body.roleKey),
      );

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// PUT /roles/:id/permissions — replace a role's permission set
// ═══════════════════════════════════════════════════════════════════

router.put(
  "/roles/:id/permissions",
  requireAuth(),
  requirePermission("roles:manage_permissions"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const roleId = pathParam(req, "id");
      const body = updateRolePermissionsSchema.parse(req.body);

      await db.transaction((tx) =>
        updateRolePermissions(
          tx,
          actor,
          roleId,
          body.permissions as Permission[],
        ),
      );

      // Return the updated role detail so the client can reflect it immediately
      const roles = await listRoles(db, actor);
      const updated = roles.find((r) => r.id === roleId);
      if (!updated) {
        throw new AppError(500, "INTERNAL", "Role vanished after update");
      }
      const perms = await findRolePermissions(db, roleId);
      res.json(toRoleDetailDto(updated, perms));
    } catch (err) {
      next(err);
    }
  },
);

export { router as rolesRouter };
