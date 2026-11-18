import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import {
  classIdParamSchema,
  cloneClassesSchema,
  createClassSchema,
  listClassesQuerySchema,
  updateClassSchema,
} from "./schema.js";
import {
  archiveClass,
  cloneClasses,
  createClass,
  findClassWithLevel,
  listClasses,
  unarchiveClass,
  updateClass,
} from "./service.js";
import { toClassDto } from "./dto.js";
import { paginateRows } from "../../../shared/dto/pagination.js";

const router = Router();

router.post(
  "/classes",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const body = createClassSchema.parse(req.body);
      const newClass = await db.transaction((tx) =>
        createClass(tx, actor, body),
      );
      res.status(201).json({ class: toClassDto(newClass) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/classes",
  requireAuth(),
  requirePermission("academics:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const query = listClassesQuerySchema.parse(req.query);
      const classes = await listClasses(db, actor, query);
      const page = paginateRows(classes, query);
      res.status(200).json({
        data: page.data.map((c) => toClassDto(c)),
        pagination: page.pagination,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/classes/:id",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = classIdParamSchema.parse(req.params);
      const body = updateClassSchema.parse(req.body);
      const updatedClass = await db.transaction((tx) =>
        updateClass(tx, actor, id, body),
      );
      res.status(200).json({ class: toClassDto(updatedClass) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/classes/:id/archive",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = classIdParamSchema.parse(req.params);
      await db.transaction((tx) => archiveClass(tx, actor, id));
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/classes/:id/unarchive",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = classIdParamSchema.parse(req.params);
      await db.transaction((tx) => unarchiveClass(tx, actor, id));
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/classes/clone",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const input = cloneClassesSchema.parse(req.body);
      const result = await db.transaction((tx) =>
        cloneClasses(tx, actor, input),
      );
      res.json({
        cloned: result.cloned.map(toClassDto),
        skipped: result.skipped,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/classes/:id",
  requireAuth(),
  requirePermission("academics:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = classIdParamSchema.parse(req.params);
      const cls = await findClassWithLevel(db, actor, id);
      res.json({ class: toClassDto(cls) });
    } catch (err) {
      next(err);
    }
  },
);

export { router as classesRouter };
