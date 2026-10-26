import { Router } from "express";
import { requireAuth } from "../auth/middleware/require-auth.js";
import { requirePermission } from "../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../rbac/actor-from-request.js";
import { listAuditQuerySchema } from "./schema.js";
import db from "../../db/client.js";
import { listAuditLog } from "./service.js";
import { AppError } from "../../shared/lib/errors.js";
import { toAuditRowDto } from "./dto.js";

const router = Router();

router.get(
  "/audit-log",
  requireAuth(),
  requirePermission("audit:read"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const query = listAuditQuerySchema.parse(req.query);

      let result;
      try {
        result = await listAuditLog(db, actor, query);
      } catch (err) {
        if (err instanceof Error && err.message === "invalid cursor") {
          return next(
            new AppError(400, "INVALID_CURSOR", "Cursor is malformed"),
          );
        }
        throw err;
      }

      res.json({
        data: result.rows.map(toAuditRowDto),
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      next(err);
    }
  },
);

export {router as auditRouter}
