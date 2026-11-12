import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import {
  addOfferingsSchema,
  classIdParamSchema,
  listOfferingsQuerySchema,
  offeringIdParamSchema,
} from "./schema.js";
import { addOfferings, listOfferings, withdrawOffering } from "./service.js";
import { toOfferingDto } from "./dto.js";

const router = Router();

router.post(
  "/classes/:classId/offerings",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { classId } = classIdParamSchema.parse(req.params);
      const body = addOfferingsSchema.parse(req.body);

      const inserted = await db.transaction((tx) =>
        addOfferings(tx, actor, { classId, subjects: body.subjects }),
      );

      res.status(201).json({ offerings: inserted.map(toOfferingDto) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/classes/:classId/offerings",
  requireAuth(),
  requirePermission("academics:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { classId } = classIdParamSchema.parse(req.params);
      const query = listOfferingsQuerySchema.parse(req.query);

      // includeArchived requires structure:manage — same rule as levels/classes/subjects.
      if (query.includeArchived && !actor.permissions.has("structure:manage")) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Cannot list archived offerings",
          },
        });
        return;
      }

      const offerings = await listOfferings(db, actor, {
        classId,
        includeArchived: query.includeArchived,
      });

      res.status(200).json({ offerings: offerings.map(toOfferingDto) });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  "/offerings/:id",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = offeringIdParamSchema.parse(req.params);
      await db.transaction((tx) => withdrawOffering(tx, actor, id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

export { router as offeringsRouter };