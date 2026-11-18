import {
  errorResponse,
  jsonResponse,
  paginationSchema,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  createSubjectSchema,
  updateSubjectSchema,
  listSubjectsQuerySchema,
  subjectIdParamSchema,
} from "./schema.js";

const SubjectDto = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    archivedAt: z.string().datetime().nullable(),
  })
  .openapi("SubjectDto");

const SubjectListResponse = z
  .object({ data: z.array(SubjectDto), pagination: paginationSchema })
  .openapi("SubjectListResponse");

registry.registerPath({
  method: "post",
  path: "/subjects",
  tags: ["Subjects"],
  summary: "Create a subject",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createSubjectSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created", SubjectDto),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    409: errorResponse("Subject code already in use."),
  },
});

registry.registerPath({
  method: "get",
  path: "/subjects",
  tags: ["Subjects"],
  summary: "List subjects",
  description:
    "Archived subjects are hidden by default; includeArchived=true requires structure:manage.",
  security: sessionSecurity,
  request: { query: listSubjectsQuerySchema },
  responses: {
    200: jsonResponse("OK", SubjectListResponse),
    401: errorResponse("Not authenticated."),
    403: errorResponse(
      "Insufficient permission, or includeArchived without structure:manage.",
    ),
  },
});

registry.registerPath({
  method: "patch",
  path: "/subjects/{id}",
  tags: ["Subjects"],
  summary: "Update a subject",
  security: sessionSecurity,
  request: {
    params: subjectIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: updateSubjectSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated", SubjectDto),
    400: errorResponse("Validation failure."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Subject not found."),
    409: errorResponse("Subject archived, or code collision."),
  },
});

registry.registerPath({
  method: "post",
  path: "/subjects/{id}/archive",
  tags: ["Subjects"],
  summary: "Archive a subject",
  description:
    "Idempotent. Refused with SUBJECT_HAS_OFFERINGS if any class offers this subject.",
  security: sessionSecurity,
  request: { params: subjectIdParamSchema },
  responses: {
    200: jsonResponse("Archived", z.object({ ok: z.literal(true) })),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Subject not found."),
    409: errorResponse("Subject has active offerings."),
  },
});
