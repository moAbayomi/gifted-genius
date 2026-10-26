// modules/audit/openapi.ts
//
// Audit response shapes + path registration. The query schema is the same
// `.strict()` schema the route parses.
import {
  errorResponse,
  jsonResponse,
  registry,
  sessionSecurity,
  z,
} from "../../openapi/registry.js";
import { listAuditQuerySchema } from "./schema.js";

// ── Response components ──────────────────────────────────────────

export const auditRowSchema = z
  .object({
    id: z.uuid(),
    action: z.string().openapi({ example: "membership.suspended" }),
    targetType: z.string().openapi({ example: "membership" }),
    targetId: z.uuid().nullable(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.iso.datetime(),
    actor: z.object({
      name: z.string().openapi({ description: "Actor's name, or `System` for platform actions" }),
      membershipId: z.uuid().nullable(),
    }),
    metadata: z.object({
      via: z.string().optional(),
      roleKey: z.string().optional(),
    }),
  })
  .openapi("AuditRow");

export const auditListResponseSchema = z
  .object({
    data: z.array(auditRowSchema),
    nextCursor: z
      .string()
      .nullable()
      .openapi({
        description:
          "Opaque cursor for the next page; null on the last page. Encodes microsecond-precision `created_at` + id, so pages have no gaps or duplicates.",
      }),
  })
  .openapi("AuditListResponse");

// ── Path ─────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/audit-log",
  tags: ["Audit"],
  summary: "List audit rows for this school",
  description:
    "Requires `audit:read`. Newest first, cursor-paginated. Always scoped to the caller's school — another " +
    "school's rows are not observable. Pass `nextCursor` back as `cursor` to continue. Snapshots are " +
    "field-picked; password hashes, tokens, IPs, and user agents are never returned. System actions have " +
    "`actor.name: \"System\"` and a null `actor.membershipId`.",
  security: sessionSecurity,
  request: { query: listAuditQuerySchema },
  responses: {
    200: jsonResponse("A page of audit rows and the next cursor.", auditListResponseSchema),
    400: errorResponse("Unknown query parameter (`VALIDATION_ERROR`) or malformed cursor (`INVALID_CURSOR`)."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `audit:read`."),
  },
});
