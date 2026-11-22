import { Router } from "express";
import { z } from "zod";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import { saveImport, validateImport } from "./service.js";
import { AppError } from "../../../shared/lib/errors.js";

const router = Router();
const bodySchema = z.object({ rows: z.array(z.unknown()) }).strict();
const classIdSchema = z.uuid();
const saveSchema = z
  .object({ rows: z.array(z.unknown()), dryRun: z.boolean().optional() })
  .strict();

router.post(
  "/students/import/validate",
  requireAuth(),
  requirePermission("users:create"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { rows } = bodySchema.parse(req.body);
      const result = await validateImport(db, actor, rows);
      res.set("Cache-Control", "no-store");
      res.json({ valid: result.valid, problems: result.problems });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/classes/:classId/students/import/validate",
  requireAuth(),
  requirePermission("students:import"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const parsedClassId = classIdSchema.safeParse(req.params.classId);
      if (!parsedClassId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid class id");
      }
      const { rows } = bodySchema.parse(req.body);
      const result = await validateImport(db, actor, rows, {
        fixedClassId: parsedClassId.data,
      });
      res.set("Cache-Control", "no-store");
      res.json({ valid: result.valid, problems: result.problems });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/classes/:classId/students/import",
  requireAuth(),
  requirePermission("students:import"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const parsedClassId = classIdSchema.safeParse(req.params.classId);
      if (!parsedClassId.success) {
        throw new AppError(400, "VALIDATION_ERROR", "Invalid class id");
      }
      const body = saveSchema.parse(req.body);
      const result = await saveImport(actor, body.rows, {
        dryRun: body.dryRun ?? false,
        fixedClassId: parsedClassId.data,
      });
      res.set("Cache-Control", "no-store");
      res.set("Pragma", "no-cache");
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/students/import",
  requireAuth(),
  requirePermission("users:create"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const body = saveSchema.parse(req.body);
      const result = await saveImport(actor, body.rows, {
        dryRun: body.dryRun ?? false,
      });
      // The response can contain one-time credentials.
      res.set("Cache-Control", "no-store");
      res.set("Pragma", "no-cache");
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

export { router as studentImportRouter };
