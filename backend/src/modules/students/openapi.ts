import {
  errorResponse,
  jsonResponse,
  registry,
  sessionSecurity,
  z,
} from "../../openapi/registry.js";
import { createStudentSchema } from "./schema.js";

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