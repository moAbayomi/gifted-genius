import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import {
  createLevelSchema,
  levelIdParamSchema,
  listLevelsQuerySchema,
  updateLevelSchema,
} from "./schema.js";
import {
  archiveLevel,
  createLevel,
  getLevel,
  listLevels,
  unarchiveLevel,
  updateLevel,
} from "./service.js";
import { toLevelDto } from "./dto.js";
import { parsePageQuery, toPaginatedDto } from "../../../shared/dto/pagination.js";

const router = Router();

router.post(
  "/levels",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const body = createLevelSchema.parse(req.body);
      const level = await db.transaction((tx) => createLevel(tx, actor, body));
      res.status(201).json({ level: toLevelDto(level) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/levels",
  requireAuth(),
  requirePermission("academics:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { includeArchived } = listLevelsQuerySchema.parse(req.query);
      const page = parsePageQuery(
        req.query as { limit?: unknown; offset?: unknown },
      );
      const all = await listLevels(db, actor, { includeArchived });
      const rows = all.slice(page.offset, page.offset + page.limit);

      res.json(
        toPaginatedDto(rows.map(toLevelDto), {
          limit: page.limit,
          offset: page.offset,
          total: all.length,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/levels/:id",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = levelIdParamSchema.parse(req.params);
      const body = updateLevelSchema.parse(req.body);

      const level = await db.transaction((tx) =>
        updateLevel(tx, actor, id, body),
      );
      res.status(200).json({ level: toLevelDto(level) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/levels/:id/archive",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = levelIdParamSchema.parse(req.params);
      await db.transaction((tx) => archiveLevel(tx, actor, id));
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/levels/:id/unarchive",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = levelIdParamSchema.parse(req.params);
      await db.transaction((tx) => unarchiveLevel(tx, actor, id));
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/levels/:id",
  requireAuth(),
  requirePermission("academics:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = levelIdParamSchema.parse(req.params);
      const level = await getLevel(db, actor, id);
      res.json({ level: toLevelDto(level) });
    } catch (err) {
      next(err);
    }
  },
);

export { router as levelsRouter };
