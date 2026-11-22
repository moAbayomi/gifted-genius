import {
  errorResponse,
  jsonResponse,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";

const importProblem = z
  .object({
    row: z.number().int(),
    field: z.string(),
    code: z.string(),
    message: z.string(),
  })
  .openapi("ImportProblem");

const importValidation = z
  .object({ valid: z.boolean(), problems: z.array(importProblem) })
  .openapi("ImportValidation");

const importCredentials = z
  .object({
    row: z.number().int(),
    studentId: z.uuid(),
    membershipId: z.uuid(),
    admissionNumber: z.string(),
    username: z.string().nullable(),
    temporaryPassword: z.string(),
  })
  .openapi("ImportCredentials");

const importSaveResult = z
  .object({
    valid: z.boolean(),
    problems: z.array(importProblem),
    created: z.number().int(),
    credentials: z.array(importCredentials),
  })
  .openapi("ImportSaveResult");

const rowsBody = z.object({ rows: z.array(z.unknown()) });

registry.registerPath({
  method: "post",
  path: "/students/import/validate",
  tags: ["Students"],
  summary: "Validate student import rows",
  description:
    "Requires `users:create`. Frontend parses CSV and sends JSON rows. Returns every problem with its 1-based row number; writes nothing.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: rowsBody } },
    },
  },
  responses: {
    200: jsonResponse("Validation result.", importValidation),
    400: errorResponse("Rows are not an array or exceed the 200-row cap."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing users:create."),
  },
});

registry.registerPath({
  method: "post",
  path: "/students/import",
  tags: ["Students"],
  summary: "Save student import rows",
  description:
    "Requires `users:create` and `enrollments:manage`. Saves all rows in one transaction, creates students and enrolments, and returns one-time credentials. Any validation problem saves nothing.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            rows: z.array(z.unknown()),
            dryRun: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Import result.", importSaveResult),
    400: errorResponse("Validation failure or more than 200 rows."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing users:create or enrollments:manage."),
  },
});

for (const [suffix, verb, summary] of [
  ["validate", "post", "Validate class student import rows"],
  ["", "post", "Save class student import rows"],
] as const) {
  const path = suffix ? `/classes/{classId}/students/import/validate` : "/classes/{classId}/students/import";
  const isValidate = suffix === "validate";
  registry.registerPath({
    method: verb,
    path,
    tags: ["Students"],
    summary,
    description:
      "Class-scoped import for the form teacher. Requires `students:import`. The route supplies class and session, so CSV rows do not need `className`. Owners and principals may target any class; a teacher may only target a class they form-teach.",
    security: sessionSecurity,
    request: {
      params: z.object({
        classId: z.uuid().openapi({
          param: { name: "classId", in: "path", description: "Class ID" },
        }),
      }),
      body: {
        required: true,
        content: {
          "application/json": {
            schema: isValidate
              ? z.object({ rows: z.array(z.unknown()) })
              : z.object({
                  rows: z.array(z.unknown()),
                  dryRun: z.boolean().optional(),
                }),
          },
        },
      },
    },
    responses: {
      200: jsonResponse(
        isValidate ? "Validation result." : "Import result.",
        isValidate ? importValidation : importSaveResult,
      ),
      400: errorResponse("Validation failure."),
      401: errorResponse("No live session."),
      403: errorResponse("Missing students:import."),
      404: errorResponse("Class not found or not form-taught by the caller."),
    },
  });
}
