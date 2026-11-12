import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import { AppError } from "../../../shared/lib/errors.js";
import {
  createAcademicSessionSchema,
  rolloverSessionSchema,
  updateAcademicSessionSchema,
} from "./schema.js";
import {
  createAcademicSession,
  currentSession,
  listAcademicSessions,
  updateAcademicSession,
} from "./service.js";
import { rolloverSession } from "../rollover.js";
import { toAcademicSessionDto } from "./dto.js";

const router = Router();

function uuidParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || !z.uuid().safeParse(value).success) {
    throw new AppError(400, "VALIDATION_ERROR", `Invalid path param '${name}'`);
  }
  return value;
}

router.post(
  "/sessions",
  requireAuth(),
  requirePermission("calendar:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { label } = createAcademicSessionSchema.parse(req.body);
      const session = await db.transaction((tx) =>
        createAcademicSession(tx, actor, label),
      );
      res.status(201).json({ session: toAcademicSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/sessions",
  requireAuth(),
  requirePermission("academics:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const sessions = await listAcademicSessions(db, actor);
      res.json({ sessions: sessions.map(toAcademicSessionDto) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/sessions/current",
  requireAuth(),
  requirePermission("academics:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const session = await currentSession(db, actor);
      res.json({ session: session ? toAcademicSessionDto(session) : null });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/sessions/:id",
  requireAuth(),
  requirePermission("calendar:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const id = uuidParam(req, "id");
      const { label } = updateAcademicSessionSchema.parse(req.body);
      const session = await db.transaction((tx) =>
        updateAcademicSession(tx, actor, id, label),
      );
      res.json({ session: toAcademicSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/sessions/:id/rollover",
  requireAuth(),
  requirePermission("structure:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const fromSessionId = uuidParam(req, "id");
      const { toSessionId } = rolloverSessionSchema.parse(req.body);
      const result = await db.transaction((tx) =>
        rolloverSession(tx, actor, { fromSessionId, toSessionId }),
      );
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export { router as academicSessionsRouter };
