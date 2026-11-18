import { Router } from "express";
import db from "../../../db/client.js";
import { requireAuth } from "../../auth/middleware/require-auth.js";
import { requirePermission } from "../../rbac/middleware/require-permission.js";
import { actorFromRequest } from "../../rbac/actor-from-request.js";
import {
  assignTeacherBodySchema,
  classIdParamSchema,
  offeringIdParamSchema,
} from "./schema.js";
import { assignFormTeacher, replaceSubjectTeacher } from "./service.js";
import {
  toFormTeacherDto,
  toSubjectTeacherAssignmentDto,
} from "./dto.js";

const router = Router();

router.post(
  "/classes/:classId/form-teacher",
  requireAuth(),
  requirePermission("assignments:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { classId } = classIdParamSchema.parse(req.params);
      const { teacherMembershipId } = assignTeacherBodySchema.parse(req.body);
      const cls = await db.transaction((tx) =>
        assignFormTeacher(tx, actor, { classId, teacherMembershipId }),
      );
      res.status(200).json({ class: toFormTeacherDto(cls) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/offerings/:classSubjectId/teacher",
  requireAuth(),
  requirePermission("assignments:manage"),
  async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const { classSubjectId } = offeringIdParamSchema.parse(req.params);
      const { teacherMembershipId } = assignTeacherBodySchema.parse(req.body);
      const assignment = await db.transaction((tx) =>
        replaceSubjectTeacher(tx, actor, {
          classSubjectId,
          teacherMembershipId,
        }),
      );
      res.status(200).json({
        assignment: toSubjectTeacherAssignmentDto(assignment),
      });
    } catch (err) {
      next(err);
    }
  },
);

export { router as assignmentsRouter };
