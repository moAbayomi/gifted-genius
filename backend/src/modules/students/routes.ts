import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import db from "../../db/client.js";
import { requireAuth } from "../auth/middleware/require-auth.js";
import { requirePermission } from "../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../rbac/actor-from-request.js";
import { createStudentSchema, listStudentsQuerySchema } from "./schema.js";
import { createStudent, listStudents } from "./service.js";
import { toStudentDto } from "./dto.js";
import { hashPassword } from "../../shared/utils/password.js";
import {
  parsePageQuery,
  toPaginatedDto,
} from "../../shared/dto/pagination.js";

const router = Router();

async function credentials() {
  const temporaryPassword = "temp-pass-1234";
  return {
    temporaryPassword,
    passwordHash: await hashPassword(temporaryPassword),
  };
}

router.get(
  "/students",
  requireAuth(),
  requirePermission("enrollments:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const page = parsePageQuery(
        req.query as { limit?: unknown; offset?: unknown },
      );
      const query = listStudentsQuerySchema.parse(req.query);
      const { rows, total } = await listStudents(db, actor, page, query);
      res.json(
        toPaginatedDto(rows, {
          limit: page.limit,
          offset: page.offset,
          total,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/students",
  requireAuth(),
  requirePermission("users:create"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = actorFromRequest(req);
      const body = createStudentSchema.parse(req.body);
      const creds = await credentials();
      const result = await db.transaction((tx) =>
        createStudent(tx, actor, body, creds),
      );

      res.status(201).json({
        student: toStudentDto({
          student: result.student,
          member: result.member,
        }),
        ...(result.temporaryPassword !== undefined && {
          temporaryPassword: result.temporaryPassword,
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

export { router as studentsRouter };
