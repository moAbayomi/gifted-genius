import {
  errorResponse,
  jsonResponse,
  paginatedSchema,
  registry,
  sessionSecurity,
  z,
} from "../../openapi/registry.js";
import { createStudentSchema, listStudentsQuerySchema } from "./schema.js";

const StudentDto = z
  .object({
    id: z.uuid(),
    membershipId: z.uuid(),
    admissionNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email().nullable(),
    username: z.string().nullable(),
    house: z.string().nullable(),
    admissionDate: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("StudentDto");

registry.registerPath({
  method: "post",
  path: "/students",
  tags: ["Students"],
  summary: "Create a student",
  description:
    "Creates a user, a membership in the caller's school, assigns the student role, and creates the student profile with the given admission number. The email must be unique across the system; the admission number must be unique within this school. Requires users:create.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createStudentSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created", StudentDto),
    400: errorResponse("Validation failure."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    409: errorResponse(
      "Email already in use, membership already a student, or admission number taken.",
    ),
  },
});

const StudentListRow = z
  .object({
    id: z.uuid(),
    membershipId: z.uuid(),
    enrollmentId: z.uuid().nullable(),
    admissionNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email().nullable(),
    username: z.string().nullable(),
    house: z.string().nullable(),
    admissionDate: z.string().nullable(),
    membershipStatus: z.enum(["active", "inactive", "suspended"]),
    classId: z.uuid().nullable(),
    levelName: z.string().nullable(),
    armLabel: z.string().nullable(),
    track: z.enum(["general", "science", "arts", "commercial"]).nullable(),
  })
  .openapi("StudentListRow");

const StudentListResponse = paginatedSchema(
  "StudentListResponse",
  StudentListRow,
);

registry.registerPath({
  method: "get",
  path: "/students",
  tags: ["Students"],
  summary: "List students",
  description:
    "The student directory for the current session. Owners and principals see the whole school; teachers see students in the classes they form-teach or teach. Pass classId to narrow to one class. Out-of-scope classes return 404. Requires enrollments:read.",
  security: sessionSecurity,
  request: { query: listStudentsQuerySchema },
  responses: {
    200: jsonResponse("A page of students.", StudentListResponse),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Class not found or outside the caller's scope."),
  },
});
