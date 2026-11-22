// modules/academics/levels/openapi.ts
//
// OpenAPI registration for level CRUD and archive actions. Request schemas
// come from ./schema.ts; response schemas match the DTO shape returned by
// the routes.
import {
  errorResponse,
  jsonResponse,
  okResponseSchema,
  paginatedSchema,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  createLevelSchema,
  updateLevelSchema,
} from "./schema.js";

export const levelDtoSchema = z
  .object({
    id: z.uuid(),
    name: z.string().openapi({ example: "JSS 1" }),
    sequence: z.number().int().openapi({ example: 1 }),
    stage: z.enum(["junior", "senior"]),
    archivedAt: z.iso.datetime().nullable(),
  })
  .openapi("Level");

export const levelResponseSchema = z
  .object({ level: levelDtoSchema })
  .openapi("LevelResponse");

export const levelListResponseSchema = paginatedSchema(
  "LevelListResponse",
  levelDtoSchema,
);

const levelIdParams = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path", description: "Level ID" },
  }),
});

const listLevelsDocsQuery = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      description:
        "Include archived levels. Requires `structure:manage`; a reader without it gets 403. Defaults to false.",
    }),
});

registry.registerPath({
  method: "post",
  path: "/levels",
  tags: ["Levels"],
  summary: "Create a level",
  description:
    "Requires `structure:manage`. Level names are trimmed and unique within the school; `sequence` must be unique and at most 32767. Duplicate name/sequence returns 409.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createLevelSchema } },
    },
  },
  responses: {
    201: jsonResponse("Level created.", levelResponseSchema),
    400: errorResponse("Validation failure."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    409: errorResponse("Duplicate name (`LEVEL_NAME_TAKEN`) or sequence (`LEVEL_SEQUENCE_TAKEN`)."),
  },
});

registry.registerPath({
  method: "get",
  path: "/levels",
  tags: ["Levels"],
  summary: "List levels",
  description:
    "Requires `academics:read`. Live levels only by default, ordered by sequence. Passing `includeArchived=true` additionally requires `structure:manage`.",
  security: sessionSecurity,
  request: { query: listLevelsDocsQuery },
  responses: {
    200: jsonResponse("Levels in this school.", levelListResponseSchema),
    400: errorResponse("Unknown or invalid query parameter."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `academics:read`, or `includeArchived=true` without `structure:manage`."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/levels/{id}",
  tags: ["Levels"],
  summary: "Update a level",
  description:
    "Requires `structure:manage`. Archived levels are read-only (`LEVEL_ARCHIVED`); unarchive first. Duplicate name/sequence returns 409. A cross-school ID returns the same 404 as a nonexistent one.",
  security: sessionSecurity,
  request: {
    params: levelIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateLevelSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated level.", levelResponseSchema),
    400: errorResponse("Validation failure or empty update."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Level not found in this school."),
    409: errorResponse("Duplicate name/sequence, or the level is archived."),
  },
});

registry.registerPath({
  method: "post",
  path: "/levels/{id}/archive",
  tags: ["Levels"],
  summary: "Archive a level",
  description:
    "Requires `structure:manage`. Refused with `LEVEL_HAS_ACTIVE_CLASSES` while a live class references the level. Idempotent: archiving an archived level returns 200 without writing a second timestamp or audit row.",
  security: sessionSecurity,
  request: { params: levelIdParams },
  responses: {
    200: jsonResponse("Level archived (or already archived).", okResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Level not found in this school."),
    409: errorResponse("Live classes still reference this level (`LEVEL_HAS_ACTIVE_CLASSES`)."),
  },
});

registry.registerPath({
  method: "post",
  path: "/levels/{id}/unarchive",
  tags: ["Levels"],
  summary: "Unarchive a level",
  description:
    "Requires `structure:manage`. Idempotent: unarchiving a live level returns 200 without a write or audit row.",
  security: sessionSecurity,
  request: { params: levelIdParams },
  responses: {
    200: jsonResponse("Level is live (or was already live).", okResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `structure:manage`."),
    404: errorResponse("Level not found in this school."),
  },
});

registry.registerPath({
  method: "get",
  path: "/levels/{id}",
  tags: ["Levels"],
  summary: "Get one level",
  description:
    "Requires `academics:read`. Cross-school IDs return 404.",
  security: sessionSecurity,
  request: { params: levelIdParams },
  responses: {
    200: jsonResponse("The level.", levelResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `academics:read`."),
    404: errorResponse("Level not found in this school."),
  },
});
