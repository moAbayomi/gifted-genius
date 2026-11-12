// modules/academics/calendar/routes.ts
import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { db } from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import { AppError } from "../../../shared/lib/errors.js";
import {
  activateTerm,
  closeTerm,
  createTerm,
  listTerms,
  lockSession,
  unlockSession,
  updateTerm,
} from "./service.js";
import {
  activateTermSchema,
  closeTermSchema,
  createTermSchema,
  listTermsQuerySchema,
  unlockSessionSchema,
  updateTermSchema,
} from "./schema.js";
import { toTermDto } from "./dto.js";

const router = Router();

function pathParam(req: Request, name: string): string {
  const v = req.params[name];
  if (typeof v !== 'string' || v.length === 0) throw new AppError(400, "VALIDATION_ERROR", `Missing path param '${name}'`);

  return v;
}

/** Path parameters are UUIDs; reject malformed IDs before they reach Postgres. */
function uuidParam(req: Request, name: string): string {
  const value = pathParam(req, name);
  if (!z.uuid().safeParse(value).success) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid path param '${name}'`);
  }
  return value;
}

router.post(
  "/terms/:termId/activate",
  requireAuth(),
  requirePermission("calendar:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const termId = uuidParam(req, "termId");
      const { confirm } = activateTermSchema.parse(req.body);
      await db.transaction((tx) => activateTerm(tx, actor, termId, confirm));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/terms/:termId/close",
  requireAuth(),
  requirePermission("calendar:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const termId = uuidParam(req, "termId");
      const { confirm } = closeTermSchema.parse(req.body);
      await db.transaction((tx) => closeTerm(tx, actor, termId, confirm));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/sessions/:sessionId/lock",
  requireAuth(),
  requirePermission("calendar:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const sessionId = uuidParam(req, "sessionId");
      await db.transaction((tx) => lockSession(tx, actor, sessionId));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/sessions/:sessionId/unlock",
  requireAuth(),
  requirePermission("calendar:unlock"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const sessionId = uuidParam(req, "sessionId");
      const { reason } = unlockSessionSchema.parse(req.body);
      await db.transaction((tx) => unlockSession(tx, actor, sessionId, reason));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/terms",
  requireAuth(),
  requirePermission("academics:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { sessionId } = listTermsQuerySchema.parse(req.query);
      const rows = await listTerms(db, actor, sessionId);
      res.json({ terms: rows.map(toTermDto) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/terms",
  requireAuth(),
  requirePermission("calendar:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const input = createTermSchema.parse(req.body);
      const created = await db.transaction((tx) => createTerm(tx, actor, input));
      res.status(201).json({ term: toTermDto(created) });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/terms/:termId",
  requireAuth(),
  requirePermission("calendar:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const termId = uuidParam(req, "termId");
      const input = updateTermSchema.parse(req.body);
      const updated = await db.transaction((tx) =>
        updateTerm(tx, actor, termId, input),
      );
      res.json({ term: toTermDto(updated) });
    } catch (err) {
      next(err);
    }
  },
);

export { router as calendarRouter };