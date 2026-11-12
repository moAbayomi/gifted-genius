// modules/academics/classes/openapi.ts
//
// OpenAPI registration for class CRUD and archive actions. Request schemas
// come from ./schema.ts; response schemas match the ClassDto returned by the
// routes (including the joined level).
import {
  errorResponse,
  jsonResponse,
  okResponseSchema,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  cloneClassesSchema,
  createClassSchema,
  updateClassSchema,
} from "./schema.js";

export const classDtoSchema = z
  .object({
    id: z.uuid(),
    sessionId: z.uuid(),
    levelId: z.uuid(),
    armLabel: z.string().openapi({ example: "A" }),
    track: z.enum(["general", "science", "arts", "commercial"]),
    level: z.object({
      id: z.uuid(),
      name: z.string().openapi({ example: "JSS 1" }),
      sequence: z.number().int(),
      stage: z.enum(["junior", "senior"]),
    }),
    archivedAt: z.iso.datetime().nullable(),
  })
  .openapi("Class");

export const classResponseSchema = z
  .object({ class: classDtoSchema })
  .openapi("ClassResponse");

export const classListResponseSchema = z
  .object({ classes: z.array(classDtoSchema) })
  .openapi("ClassListResponse");

const classIdParams = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path", description: "Class ID" },
  }),
});

const listClassesDocsQuery = z.object({
  sessionId: z.uuid().openapi({
    description: "Academic session to list classes for. Required.",
  }),
  levelId: z.uuid().optional(),
  track: z.enum(["general", "science", "arts", "commercial"]).optional(),
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      description:
        "Include archived classes. Requires `structure:manage`; a reader without it gets 403. Defaults to false.",
    }),
});

registry.registerPath({
  method: "post",
  path: "/classes",
  tags: ["Classes"],
  summary: "Create a class",
  description:
    "Requires `structure:manage`. The session must be open (not locked) and the level must be live. Junior levels accept only `general`; senior levels accept `science`, `arts`, or `commercial`. A duplicate `(session, level, arm, track)` returns `CLASS_ALREADY_EXISTS`.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createClassSchema } },
    },
  },
  responses: {
    201: jsonResponse("Class created.", classResponseSchema),
    400: errorResponse("Validation failure or an invalid track for the level's stage (`INVALID_TRACK`)."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Session or level not found in this school."),
    409: errorResponse(
      "Duplicate live class (`CLASS_ALREADY_EXISTS`), archived class occupying the tuple (`CLASS_ARCHIVED_EXISTS`), archived level, or locked session.",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/classes",
  tags: ["Classes"],
  summary: "List classes",
  description:
    "Requires `academics:read`. `sessionId` is required. Live classes only by default; `includeArchived=true` additionally requires `structure:manage`. Returns each class with its level.",
  security: sessionSecurity,
  request: { query: listClassesDocsQuery },
  responses: {
    200: jsonResponse("Classes in this session.", classListResponseSchema),
    400: errorResponse("Missing `sessionId` or an invalid/unknown query parameter."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `academics:read`, or `includeArchived=true` without `structure:manage`."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/classes/{id}",
  tags: ["Classes"],
  summary: "Update a class",
  description:
    "Requires `structure:manage`. Only `armLabel` and `track` can change. Archived classes are read-only (`CLASS_ARCHIVED`); a live class under an archived level is also read-only (`LEVEL_ARCHIVED`). Track changes are validated against the level's stage.",
  security: sessionSecurity,
  request: {
    params: classIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateClassSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated class.", classResponseSchema),
    400: errorResponse("Validation failure, empty update, or invalid track."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Class not found in this school."),
    409: errorResponse("Duplicate class, archived class, or archived level."),
  },
});

registry.registerPath({
  method: "post",
  path: "/classes/{id}/archive",
  tags: ["Classes"],
  summary: "Archive a class",
  description:
    "Requires `structure:manage`. Idempotent: archiving an archived class returns 200 without a second timestamp or audit row. The dependency guard is a placeholder until offerings and enrolments land in 2b.",
  security: sessionSecurity,
  request: { params: classIdParams },
  responses: {
    200: jsonResponse("Class archived (or already archived).", okResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Class not found in this school."),
  },
});

registry.registerPath({
  method: "post",
  path: "/classes/{id}/unarchive",
  tags: ["Classes"],
  summary: "Unarchive a class",
  description:
    "Requires `structure:manage`. Refused with `LEVEL_ARCHIVED` if the parent level is archived. Idempotent: unarchiving a live class returns 200 without a write or audit row.",
  security: sessionSecurity,
  request: { params: classIdParams },
  responses: {
    200: jsonResponse("Class is live (or was already live).", okResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Class or its level not found."),
    409: errorResponse("The parent level is archived (`LEVEL_ARCHIVED`)."),
  },
});

const cloneResponse = z
  .object({
    cloned: z.array(classDtoSchema),
    skipped: z.array(
      z.object({
        classId: z.uuid(),
        levelId: z.uuid(),
        reason: z.literal("LEVEL_ARCHIVED"),
      }),
    ),
  })
  .openapi("ClassCloneResponse");

registry.registerPath({
  method: "post",
  path: "/classes/clone",
  tags: ["Classes"],
  summary: "Clone live classes into another session",
  description:
    "Requires `structure:manage`. Copies live classes at the same level, arm and track into an open target session. Archived classes and classes whose level is archived are skipped and reported. Idempotent.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: cloneClassesSchema } },
    },
  },
  responses: {
    200: jsonResponse("Cloned classes and skipped classes.", cloneResponse),
    400: errorResponse("Validation failure or same source/target session."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Source or target session not found in this school."),
    409: errorResponse("Target session is locked."),
  },
});

registry.registerPath({
  method: "get",
  path: "/classes/{id}",
  tags: ["Classes"],
  summary: "Get one class",
  description:
    "Requires `academics:read`. Returns the class with its level. Cross-school IDs return 404.",
  security: sessionSecurity,
  request: { params: classIdParams },
  responses: {
    200: jsonResponse("The class.", classResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `academics:read`."),
    404: errorResponse("Class not found in this school."),
  },
});
