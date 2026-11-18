import {
  errorResponse,
  jsonResponse,
  paginationSchema,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  createElectiveGroupSchema,
  updateElectiveGroupSchema,
  listElectiveGroupsQuerySchema,
  electiveGroupIdParamSchema,
} from "./schema.js";

const ElectiveGroupDto = z
  .object({
    id: z.uuid(),
    classId: z.uuid(),
    name: z.string(),
    minChoices: z.number().int(),
    maxChoices: z.number().int(),
    archivedAt: z.string().datetime().nullable(),
  })
  .openapi("ElectiveGroupDto");

const ElectiveGroupListResponse = z
  .object({ data: z.array(ElectiveGroupDto), pagination: paginationSchema })
  .openapi("ElectiveGroupListResponse");

registry.registerPath({
  method: "post",
  path: "/elective-groups",
  tags: ["Elective Groups"],
  summary: "Create an elective group",
  description:
    "Requires structure:manage. The class must exist in the caller's school. Group name is unique per class.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createElectiveGroupSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created", ElectiveGroupDto),
    400: errorResponse("Validation failure (maxChoices < minChoices, etc.)."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Class not found."),
    409: errorResponse("Group name already exists in this class."),
  },
});

registry.registerPath({
  method: "get",
  path: "/elective-groups",
  tags: ["Elective Groups"],
  summary: "List elective groups for a class",
  description:
    "`classId` is required. Archived groups are hidden by default; `includeArchived=true` requires structure:manage.",
  security: sessionSecurity,
  request: { query: listElectiveGroupsQuerySchema },
  responses: {
    200: jsonResponse("OK", ElectiveGroupListResponse),
    401: errorResponse("Not authenticated."),
    403: errorResponse(
      "Insufficient permission, or includeArchived without structure:manage.",
    ),
    404: errorResponse("Class not found in this school."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/elective-groups/{id}",
  tags: ["Elective Groups"],
  summary: "Update an elective group",
  description:
    "Updates name and/or choice bounds. If only one bound is provided, the other stays; the service still enforces maxChoices >= minChoices across the merged result.",
  security: sessionSecurity,
  request: {
    params: electiveGroupIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: updateElectiveGroupSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated", ElectiveGroupDto),
    400: errorResponse("Validation failure, or merged bounds are invalid."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Elective group not found."),
    409: errorResponse("Group is archived."),
  },
});

registry.registerPath({
  method: "post",
  path: "/elective-groups/{id}/archive",
  tags: ["Elective Groups"],
  summary: "Archive an elective group",
  description:
    "Idempotent. Refused with ELECTIVE_GROUP_HAS_OFFERINGS if any class_subjects row references this group.",
  security: sessionSecurity,
  request: { params: electiveGroupIdParamSchema },
  responses: {
    200: jsonResponse("Archived", z.object({ ok: z.literal(true) })),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Elective group not found."),
    409: errorResponse("Group still has offerings assigned."),
  },
});
