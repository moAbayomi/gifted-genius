import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import {
  createSubjectSchema,
  listSubjectsQuerySchema,
  subjectIdParamSchema,
  updateSubjectSchema,
} from "./schema.js";
import {
  archiveSubject,
  createSubject,
  listSubjects,
  updateSubject,
} from "./service.js";
import { toSubjectDto } from "./dto.js";

const router = Router();

router.post(
  "/subjects",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const body = createSubjectSchema.parse(req.body);
      const created = await db.transaction((tx) =>
        createSubject(tx, actor, body),
      );
      res.status(201).json({ subject: toSubjectDto(created) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/subjects",
  requireAuth(),
  requirePermission("academics:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const query = listSubjectsQuerySchema.parse(req.query);

      // includeArchived requires structure:manage — same rule as levels/classes.
      if (query.includeArchived && !actor.permissions.has("structure:manage")) {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "Cannot list archived subjects" } });
        return;
      }

      const subjects = await listSubjects(db, actor, query);
      res.status(200).json({ subjects: subjects.map(toSubjectDto) });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/subjects/:id",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = subjectIdParamSchema.parse(req.params);
      const body = updateSubjectSchema.parse(req.body);
      const updated = await db.transaction((tx) =>
        updateSubject(tx, actor, id, body),
      );
      res.status(200).json({ subject: toSubjectDto(updated) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/subjects/:id/archive",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = subjectIdParamSchema.parse(req.params);
      await db.transaction((tx) => archiveSubject(tx, actor, id));
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export { router as subjectsRouter };
