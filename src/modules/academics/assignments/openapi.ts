import {
  errorResponse,
  jsonResponse,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  assignTeacherBodySchema,
  classIdParamSchema,
  offeringIdParamSchema,
} from "./schema.js";

const formTeacherResponse = z
  .object({
    class: z.object({
      classId: z.uuid(),
      formTeacherMembershipId: z.uuid().nullable(),
    }),
  })
  .openapi("FormTeacherResponse");

const assignmentResponse = z
  .object({
    assignment: z.object({
      id: z.uuid(),
      classId: z.uuid(),
      classSubjectId: z.uuid(),
      teacherMembershipId: z.uuid(),
      assignedAt: z.iso.datetime(),
      endedAt: z.iso.datetime().nullable(),
    }),
  })
  .openapi("SubjectTeacherAssignmentResponse");

const meAssignmentsResponse = z
  .object({
    session: z.object({ id: z.uuid(), label: z.string() }).nullable(),
    formTeacherClasses: z.array(
      z.object({
        id: z.uuid(),
        levelName: z.string(),
        armLabel: z.string(),
        track: z.string(),
        displayName: z.string(),
      }),
    ),
    subjectOfferings: z.array(
      z.object({
        id: z.uuid(),
        classId: z.uuid(),
        className: z.string(),
        subject: z.object({
          id: z.uuid(),
          code: z.string(),
          name: z.string(),
        }),
      }),
    ),
  })
  .openapi("MeAssignmentsResponse");

registry.registerPath({
  method: "post",
  path: "/classes/{classId}/form-teacher",
  tags: ["Classes"],
  summary: "Assign or replace the form teacher",
  description:
    "Requires `assignments:manage`. The target must be an active staff-kind member of this school. The class session must be unlocked. Replacing writes before/after audit.",
  security: sessionSecurity,
  request: {
    params: classIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: assignTeacherBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Form teacher assigned.", formTeacherResponse),
    400: errorResponse("Invalid body or param."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing permission or target is not active staff."),
    404: errorResponse("Class or member not found in this school."),
    409: errorResponse("Class archived or session locked."),
  },
});

registry.registerPath({
  method: "post",
  path: "/offerings/{classSubjectId}/teacher",
  tags: ["Classes"],
  summary: "Assign or replace a subject teacher",
  description:
    "Requires `assignments:manage`. Ends the offering's active assignment(s) and creates the new active row in one transaction. The target must be active staff-kind. Session must be unlocked.",
  security: sessionSecurity,
  request: {
    params: offeringIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: assignTeacherBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Subject teacher assigned.", assignmentResponse),
    400: errorResponse("Invalid body or param."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing permission or target is not active staff."),
    404: errorResponse("Offering or member not found in this school."),
    409: errorResponse("Class archived or session locked."),
  },
});

registry.registerPath({
  method: "get",
  path: "/me/assignments",
  tags: ["Auth"],
  summary: "Current staff assignments",
  description:
    "Staff-kind members only. Returns the active session, form-teacher classes, and taught offerings with names. Student and guardian members receive 403 STAFF_ONLY.",
  security: sessionSecurity,
  responses: {
    200: jsonResponse("Current assignments.", meAssignmentsResponse),
    401: errorResponse("No live session."),
    403: errorResponse("Not a staff-kind member."),
  },
});
