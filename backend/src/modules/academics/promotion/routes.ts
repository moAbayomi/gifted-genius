import { Router } from "express";
import { z } from "zod";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import { commitPromotion, previewPromotions } from "./service.js";

const router = Router();

const sessionIdParam = z.object({ sourceSessionId: z.uuid() }).strict();
const previewQuery = z.object({ targetSessionId: z.uuid() }).strict();
const commitBody = z
  .object({
    targetSessionId: z.uuid(),
    rows: z
      .array(
        z
          .object({
            enrollmentId: z.uuid(),
            targetClassId: z.uuid().nullable(),
            repeat: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

router.get(
  "/sessions/:sourceSessionId/promotion/preview",
  requireAuth(),
  requirePermission("enrollments:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { sourceSessionId } = sessionIdParam.parse(req.params);
      const { targetSessionId } = previewQuery.parse(req.query);
      res.json(
        await previewPromotions(db, actor, { sourceSessionId, targetSessionId }),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/sessions/:sourceSessionId/promotion/commit",
  requireAuth(),
  requirePermission("enrollments:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { sourceSessionId } = sessionIdParam.parse(req.params);
      const body = commitBody.parse(req.body);
      res.json(
        await commitPromotion(actor, {
          sourceSessionId,
          targetSessionId: body.targetSessionId,
          rows: body.rows.map(({ enrollmentId, targetClassId, repeat }) => ({
            enrollmentId,
            targetClassId,
            ...(repeat !== undefined ? { repeat } : {}),
          })),
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

export { router as promotionRouter };
