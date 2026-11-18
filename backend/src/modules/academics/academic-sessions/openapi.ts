import {
  errorResponse,
  jsonResponse,
  paginationSchema,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  createAcademicSessionSchema,
  rolloverSessionSchema,
  updateAcademicSessionSchema,
} from "./schema.js";

const sessionDto = z
  .object({
    id: z.uuid(),
    label: z.string(),
    closedAt: z.iso.datetime().nullable(),
  })
  .openapi("AcademicSession");

const sessionResponse = z
  .object({ session: sessionDto })
  .openapi("AcademicSessionResponse");
const sessionList = z
  .object({ data: z.array(sessionDto), pagination: paginationSchema })
  .openapi("AcademicSessionListResponse");
const currentResponse = z
  .object({ session: sessionDto.nullable() })
  .openapi("CurrentSessionResponse");
const sessionIdParams = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path", description: "Academic session ID" },
  }),
});

registry.registerPath({
  method: "post",
  path: "/sessions",
  tags: ["Calendar"],
  summary: "Create an academic session",
  description:
    "Requires `calendar:manage`. The label must be `YYYY/YYYY` and the second year must be the first plus one. Duplicate labels in the same school return 409.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createAcademicSessionSchema } },
    },
  },
  responses: {
    201: jsonResponse("Session created.", sessionResponse),
    400: errorResponse("Invalid label."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    409: errorResponse("Label already exists at this school."),
  },
});

registry.registerPath({
  method: "get",
  path: "/sessions",
  tags: ["Calendar"],
  summary: "List academic sessions",
  description: "Requires `academics:read`. Newest label first.",
  security: sessionSecurity,
  responses: {
    200: jsonResponse("Sessions at this school.", sessionList),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `academics:read`."),
  },
});

registry.registerPath({
  method: "get",
  path: "/sessions/current",
  tags: ["Calendar"],
  summary: "Get the current academic session",
  description:
    "Requires `academics:read`. Returns the active term's session, else the most recent session by label. `closed_at` is ignored; writability is a separate guard.",
  security: sessionSecurity,
  responses: {
    200: jsonResponse("Current session or null.", currentResponse),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `academics:read`."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/sessions/{id}",
  tags: ["Calendar"],
  summary: "Update an academic session label",
  description:
    "Requires `calendar:manage`. Validates the label and consecutive years; duplicate labels return 409.",
  security: sessionSecurity,
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateAcademicSessionSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated session.", sessionResponse),
    400: errorResponse("Invalid label."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `calendar:manage`."),
    404: errorResponse("Session not found in this school."),
    409: errorResponse("Label already exists at this school."),
  },
});

const rolloverResponse = z
  .object({
    classesCloned: z.number().int(),
    groupsCopied: z.number().int(),
    offeringsCopied: z.number().int(),
  })
  .openapi("SessionRolloverResponse");

registry.registerPath({
  method: "post",
  path: "/sessions/{id}/rollover",
  tags: ["Calendar"],
  summary: "Roll a session's classes and offerings into another session",
  description:
    "Requires `structure:manage`. `{id}` is the source session; the body names the open target session. Classes are cloned first, then elective groups, then active offerings. Idempotent: a second run inserts nothing.",
  security: sessionSecurity,
  request: {
    params: sessionIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: rolloverSessionSchema } },
    },
  },
  responses: {
    200: jsonResponse("Rollover counts.", rolloverResponse),
    400: errorResponse("Same source and target session or invalid body."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Source or target session not found in this school."),
    409: errorResponse("Target session is locked."),
  },
});
