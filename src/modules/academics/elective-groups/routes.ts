import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import {
  createElectiveGroupSchema,
  electiveGroupIdParamSchema,
  listElectiveGroupsQuerySchema,
  updateElectiveGroupSchema,
} from "./schema.js";
import {
  archiveElectiveGroup,
  createElectiveGroup,
  listElectiveGroups,
  updateElectiveGroup,
} from "./service.js";
import { toElectiveGroupDto } from "./dto.js";

const router = Router();

router.post(
  "/elective-groups",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const body = createElectiveGroupSchema.parse(req.body);
      const created = await db.transaction((tx) =>
        createElectiveGroup(tx, actor, body),
      );
      res.status(201).json({ electiveGroup: toElectiveGroupDto(created) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/elective-groups",
  requireAuth(),
  requirePermission("academics:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const query = listElectiveGroupsQuerySchema.parse(req.query);

      // includeArchived requires structure:manage — same rule as levels/classes/subjects.
      if (query.includeArchived && !actor.permissions.has("structure:manage")) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Cannot list archived elective groups",
          },
        });
        return;
      }

      const groups = await listElectiveGroups(db, actor, query);
      res.status(200).json({ electiveGroups: groups.map(toElectiveGroupDto) });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/elective-groups/:id",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = electiveGroupIdParamSchema.parse(req.params);
      const body = updateElectiveGroupSchema.parse(req.body);
      const updated = await db.transaction((tx) =>
        updateElectiveGroup(tx, actor, id, body),
      );
      res.status(200).json({ electiveGroup: toElectiveGroupDto(updated) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/elective-groups/:id/archive",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = electiveGroupIdParamSchema.parse(req.params);
      await db.transaction((tx) => archiveElectiveGroup(tx, actor, id));
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export { router as electiveGroupsRouter };