// modules/academics/calendar/openapi.ts
//
// Path registration for the calendar transitions. Request schemas come from
// ./schema.ts so the routes and the docs share them.
import {
  errorResponse,
  jsonResponse,
  okResponseSchema,
  paginationSchema,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  activateTermSchema,
  closeTermSchema,
  createTermSchema,
  unlockSessionSchema,
  updateTermSchema,
} from "./schema.js";

const termIdParams = z.object({
  termId: z.uuid().openapi({
    param: { name: "termId", in: "path", description: "Term ID" },
  }),
});

const sessionIdParams = z.object({
  sessionId: z.uuid().openapi({
    param: { name: "sessionId", in: "path", description: "Academic session ID" },
  }),
});

registry.registerPath({
  method: "post",
  path: "/terms/{termId}/activate",
  tags: ["Calendar"],
  summary: "Activate a term",
  description:
    "Requires `calendar:manage` and an explicit `confirm: true`. The term must be `planned` and its session unlocked. For term N > 1, term N-1 must exist and be closed. If another term is active, it is closed in the same transaction before the target activates. The school-row lock serializes concurrent calendar mutations; the one-active-term partial unique index is the database backstop.",
  security: sessionSecurity,
  request: {
    params: termIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: activateTermSchema } },
    },
  },
  responses: {
    200: jsonResponse("Term is now active.", okResponseSchema),
    400: errorResponse("Malformed term ID, or a missing prior term (`TERM_SEQUENCE_BROKEN`)."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    404: errorResponse("Term not found in this school."),
    409: errorResponse(
      "Session locked (`SESSION_LOCKED`), invalid transition, prior term not closed (`TERM_NOT_SEQUENTIAL`), or another term active (`TERM_ALREADY_ACTIVE`).",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/terms/{termId}/close",
  tags: ["Calendar"],
  summary: "Close a term",
  description:
    "Requires `calendar:manage` and an explicit `confirm: true`. Only `active → closed` is allowed. Closing a term does not make its results immutable; corrections go through result versions when that module exists.",
  security: sessionSecurity,
  request: {
    params: termIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: closeTermSchema } },
    },
  },
  responses: {
    200: jsonResponse("Term is now closed.", okResponseSchema),
    400: errorResponse("Malformed term ID, validation failure, or missing confirmation."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    404: errorResponse("Term not found in this school."),
    409: errorResponse("The term is not active, or the transition is not allowed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/sessions/{sessionId}/lock",
  tags: ["Calendar"],
  summary: "Lock an academic session",
  description:
    "Requires `calendar:manage`. Every term in the session must already be `closed`. Sets `closed_at`, which gates new session-scoped writes. The lock is an explicit act, not a state derived from the terms. Reopening requires a reason.",
  security: sessionSecurity,
  request: { params: sessionIdParams },
  responses: {
    200: jsonResponse("Session locked.", okResponseSchema),
    400: errorResponse("Malformed session ID."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    404: errorResponse("Academic session not found in this school."),
    409: errorResponse("Session already locked, or one or more terms are not closed."),
  },
});

registry.registerPath({
  method: "post",
  path: "/sessions/{sessionId}/unlock",
  tags: ["Calendar"],
  summary: "Unlock an academic session",
  description:
    "Requires `calendar:unlock` (owner-only by default), plus a reason (10–500 chars) recorded in the audit log. Clears `closed_at`; it does not reopen any term. Ended enrolments stay ended.",
  security: sessionSecurity,
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: unlockSessionSchema } },
    },
  },
  responses: {
    200: jsonResponse("Session unlocked.", okResponseSchema),
    400: errorResponse("Malformed session ID, or a missing/too-short reason."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    404: errorResponse("Academic session not found in this school."),
    409: errorResponse("Session is not locked."),
  },
});

const termDto = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    number: z.number().int(),
    name: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    status: z.enum(["planned", "active", "closed"]),
    dataEntryState: z.enum(["open", "closed"]),
  })
  .openapi("Term");

const termResponse = z.object({ term: termDto }).openapi("TermResponse");
const termListResponse = z
  .object({ data: z.array(termDto), pagination: paginationSchema })
  .openapi("TermListResponse");

registry.registerPath({
  method: "get",
  path: "/terms",
  tags: ["Calendar"],
  summary: "List terms in a session",
  description: "Requires `academics:read`. Ordered by term number.",
  security: sessionSecurity,
  request: {
    query: z.object({ sessionId: z.uuid().openapi({ description: "Academic session ID" }) }),
  },
  responses: {
    200: jsonResponse("Terms in the session.", termListResponse),
    400: errorResponse("Missing or invalid sessionId."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `academics:read`."),
  },
});

registry.registerPath({
  method: "post",
  path: "/terms",
  tags: ["Calendar"],
  summary: "Create a term",
  description:
    "Requires `calendar:manage`. Takes the school then session lock, validates real dates, refuses a locked session, and refuses overlapping dates.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTermSchema } },
    },
  },
  responses: {
    201: jsonResponse("Term created.", termResponse),
    400: errorResponse("Invalid dates or sequence."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    404: errorResponse("Session not found in this school."),
    409: errorResponse("Overlapping dates, duplicate number, or locked session."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/terms/{termId}",
  tags: ["Calendar"],
  summary: "Update a term",
  description:
    "Requires `calendar:manage`. Updates name/dates, rechecks real dates and overlap excluding this term, and refuses a locked session.",
  security: sessionSecurity,
  request: {
    params: termIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateTermSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated term.", termResponse),
    400: errorResponse("Invalid dates or empty update."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    404: errorResponse("Term not found in this school."),
    409: errorResponse("Overlapping dates or locked session."),
  },
});
