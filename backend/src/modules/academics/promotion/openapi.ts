import {
  errorResponse,
  jsonResponse,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";

const promotionRow = z
  .object({
    enrollmentId: z.uuid(),
    studentId: z.uuid(),
    sourceClassId: z.uuid(),
    targetClassId: z.uuid().nullable(),
    targetLevelId: z.uuid().nullable(),
    action: z.enum(["promote", "graduate", "choose_track", "no_matching_class"]),
    warning: z.enum(["CHOOSE_TRACK", "NO_MATCHING_CLASS"]).nullable(),
    warnings: z.array(z.string()),
  })
  .openapi("PromotionRow");

const promotionGroup = z
  .object({
    targetClassId: z.uuid().nullable(),
    targetClassName: z.string().nullable(),
    count: z.number().int(),
    rows: z.array(promotionRow),
  })
  .openapi("PromotionGroup");

const promotionPreview = z
  .object({
    sourceSessionId: z.uuid(),
    targetSessionId: z.uuid(),
    groups: z.array(promotionGroup),
    rows: z.array(promotionRow),
    counts: z.record(z.string(), z.number().int()),
  })
  .openapi("PromotionPreview");

const promotionCommit = z
  .object({
    created: z.number().int(),
    sourceEnded: z.number().int(),
    subjectsCreated: z.number().int(),
    skipped: z.array(
      z.object({
        enrollmentId: z.uuid(),
        reason: z.string(),
      }),
    ),
  })
  .openapi("PromotionCommitResult");

registry.registerPath({
  method: "get",
  path: "/sessions/{sourceSessionId}/promotion/preview",
  tags: ["Promotion"],
  summary: "Preview a promotion plan",
  description:
    "Requires `enrollments:manage`. Read-only. Returns suggestions grouped by target class, with `NO_OFFERINGS`, `CHOOSE_TRACK`, `NO_MATCHING_CLASS`, and graduation outcomes.",
  security: sessionSecurity,
  request: {
    params: z.object({ sourceSessionId: z.uuid() }),
    query: z.object({ targetSessionId: z.uuid() }),
  },
  responses: {
    200: jsonResponse("Promotion preview.", promotionPreview),
    400: errorResponse("Invalid session ids."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing enrollments:manage."),
    404: errorResponse("Session not found."),
  },
});

registry.registerPath({
  method: "post",
  path: "/sessions/{sourceSessionId}/promotion/commit",
  tags: ["Promotion"],
  summary: "Commit a promotion plan",
  description:
    "Requires `enrollments:manage`. Validates every row before writing, locks the school, ends source enrolments, creates target enrolments and compulsory subjects, and reports already-promoted students.",
  security: sessionSecurity,
  request: {
    params: z.object({ sourceSessionId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            targetSessionId: z.uuid(),
            rows: z.array(
              z.object({
                enrollmentId: z.uuid(),
                targetClassId: z.uuid().nullable(),
                repeat: z.boolean().optional(),
              }),
            ),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Promotion committed.", promotionCommit),
    400: errorResponse("Invalid plan or earlier target session."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing enrollments:manage."),
    404: errorResponse("Session, enrollment or class not found."),
    409: errorResponse("Locked session, archived class, or target class without offerings."),
  },
});
