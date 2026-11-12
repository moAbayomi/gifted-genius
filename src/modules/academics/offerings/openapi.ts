import {
  errorResponse,
  jsonResponse,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  addOfferingsSchema,
  classIdParamSchema,
  listOfferingsQuerySchema,
  offeringIdParamSchema,
} from "./schema.js";

const OfferingDto = z
  .object({
    id: z.uuid(),
    classId: z.uuid(),
    subjectId: z.uuid(),
    subject: z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
    }),
    isCompulsory: z.boolean(),
    electiveGroupId: z.uuid().nullable(),
    archivedAt: z.string().datetime().nullable(),
  })
  .openapi("OfferingDto");

const OfferingListResponse = z
  .object({ offerings: z.array(OfferingDto) })
  .openapi("OfferingListResponse");

registry.registerPath({
  method: "post",
  path: "/classes/{classId}/offerings",
  tags: ["Offerings"],
  summary: "Add offerings to a class",
  description:
    "Bulk insert. The class must be in an open session and not archived. Any archived subject in the batch rejects the whole request (atomic). A compulsory offering cannot carry an electiveGroupId. Compulsory offerings auto-enroll every active enrollment in the class.",
  security: sessionSecurity,
  request: {
    params: classIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: addOfferingsSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created", OfferingListResponse),
    400: errorResponse(
      "Validation failure (duplicate subjectId, compulsory + electiveGroupId).",
    ),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Class, subject, or elective group not found."),
    409: errorResponse(
      "Class archived, session locked, or offering already exists.",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/classes/{classId}/offerings",
  tags: ["Offerings"],
  summary: "List a class's offerings",
  description:
    "Archived offerings are hidden by default; includeArchived=true requires structure:manage.",
  security: sessionSecurity,
  request: {
    params: classIdParamSchema,
    query: listOfferingsQuerySchema,
  },
  responses: {
    200: jsonResponse("OK", OfferingListResponse),
    401: errorResponse("Not authenticated."),
    403: errorResponse(
      "Insufficient permission, or includeArchived without structure:manage.",
    ),
    404: errorResponse("Class not found in this school."),
  },
});

registry.registerPath({
  method: "delete",
  path: "/offerings/{id}",
  tags: ["Offerings"],
  summary: "Withdraw an offering",
  description:
    "Hard delete. Drops every student_subjects row that references this offering, then deletes the offering itself. Refused if the session is locked or the class is archived.",
  security: sessionSecurity,
  request: { params: offeringIdParamSchema },
  responses: {
    204: { description: "Withdrawn — no content." },
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Offering not found in this school."),
    409: errorResponse("Class archived, or session locked."),
  },
});
