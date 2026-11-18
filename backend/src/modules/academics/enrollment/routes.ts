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
  listEnrollmentsQuerySchema,
  setElectivesBodySchema,
  transferBodySchema,
  withdrawBodySchema,
} from "./schema.js";
import {
  bulkEnroll,
  enrollStudent,
  getEnrollmentById,
  listEnrollments,
} from "./service.js";
import { getClassRoster } from "./roster.js";
import { paginationQuerySchema } from "../../../shared/dto/pagination.js";
import { setElectives } from "./electives.js";
import { transferStudent } from "./transfer.js";
import { withdrawEnrollment } from "./withdraw.js";
import {
  toBulkEnrollDto,
  toElectivesResultDto,
  toEnrollResultDto,
  toEnrollmentDto,
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
      const page = paginationQuerySchema.strict().parse(req.query);
      const roster = await getClassRoster(db, actor, {
        classId,
        ...(page.limit !== undefined ? { limit: page.limit } : {}),
        ...(page.offset !== undefined ? { offset: page.offset } : {}),
      });
      res.status(200).json({
        data: roster.students,
        pagination: {
          limit: page.limit ?? 50,
          offset: page.offset ?? 0,
          total: roster.total,
          hasMore: (page.offset ?? 0) + roster.students.length < roster.total,
          nextCursor: null,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/enrollments",
  requireAuth(),
  requirePermission("enrollments:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const query = listEnrollmentsQuerySchema.parse(req.query);
      const { rows, total } = await listEnrollments(db, actor, query);
      res.status(200).json({
        data: rows.map(toEnrollmentDto),
        pagination: {
          limit: query.limit ?? 50,
          offset: query.offset ?? 0,
          total,
          hasMore: (query.offset ?? 0) + rows.length < total,
          nextCursor: null,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/enrollments/:id",
  requireAuth(),
  requirePermission("enrollments:read"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const { id } = enrollmentIdParamSchema.parse(req.params);
      const row = await getEnrollmentById(db, actor, id);
      res.status(200).json({ enrollment: toEnrollmentDto(row) });
    } catch (err) {
      next(err);
    }
  },
);

export { router as enrollmentsRouter };