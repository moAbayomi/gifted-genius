import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import {
  bulkEnrollSchema,
  classIdParamSchema,
  enrollStudentSchema,
  enrollmentIdParamSchema,
  setElectivesBodySchema,
  transferBodySchema,
  withdrawBodySchema,
} from "./schema.js";
import { bulkEnroll, enrollStudent } from "./service.js";
import { getClassRoster } from "./roster.js";
import { setElectives } from "./electives.js";
import { transferStudent } from "./transfer.js";
import { withdrawEnrollment } from "./withdraw.js";
import {
  toBulkEnrollDto,
  toElectivesResultDto,
  toEnrollResultDto,
  toTransferDto,
} from "./dto.js";

const router = Router();

// ── POST /enrollments ─────────────────────────────────────────────────
router.post(
  "/enrollments",
  requireAuth(),
  requirePermission("enrollments:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const body = enrollStudentSchema.parse(req.body);
      const result = await db.transaction((tx) =>
        enrollStudent(tx, actor, body),
      );
      res.status(201).json(toEnrollResultDto(result));
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /enrollments/bulk ────────────────────────────────────────────
// 200, not 201 — bulkEnroll may be a dryRun (nothing persisted) and
// returns a summary list rather than individual "created" resources.
router.post(
  "/enrollments/bulk",
  requireAuth(),
  requirePermission("enrollments:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const body = bulkEnrollSchema.parse(req.body);
      const results = await bulkEnroll(actor, body);
      res.status(200).json(toBulkEnrollDto(results));
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /enrollments/:id/electives ───────────────────────────────────
router.post(
  "/enrollments/:id/electives",
  requireAuth(),
  requirePermission("enrollments:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = enrollmentIdParamSchema.parse(req.params);
      const body = setElectivesBodySchema.parse(req.body);
      const result = await db.transaction((tx) =>
        setElectives(tx, actor, {
          enrollmentId: id,
          offeringIds: body.offeringIds,
        }),
      );
      res.status(200).json(toElectivesResultDto(result));
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /enrollments/:id/transfer ────────────────────────────────────
router.post(
  "/enrollments/:id/transfer",
  requireAuth(),
  requirePermission("enrollments:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = enrollmentIdParamSchema.parse(req.params);
      const body = transferBodySchema.parse(req.body);
      const result = await db.transaction((tx) =>
        transferStudent(tx, actor, {
          enrollmentId: id,
          targetClassId: body.targetClassId,
        }),
      );
      res.status(200).json(toTransferDto(result));
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /enrollments/:id/withdraw ────────────────────────────────────
router.post(
  "/enrollments/:id/withdraw",
  requireAuth(),
  requirePermission("enrollments:manage"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = enrollmentIdParamSchema.parse(req.params);
      const body = withdrawBodySchema.parse(req.body);
      await db.transaction((tx) =>
        withdrawEnrollment(tx, actor, {
          enrollmentId: id,
          reason: body.reason,
        }),
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/classes/:classId/roster",
  requireAuth(),
  requirePermission("enrollments:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { classId } = classIdParamSchema.parse(req.params);
      const roster = await getClassRoster(db, actor, { classId });
      res.status(200).json({
        roster: roster.students,
        count: roster.students.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

export { router as enrollmentsRouter };