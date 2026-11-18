import {
  errorResponse,
  jsonResponse,
  paginationSchema,
  registry,
  sessionSecurity,
  z,
} from "../../../openapi/registry.js";
import {
  bulkEnrollSchema,
  enrollStudentSchema,
  enrollmentIdParamSchema,
  setElectivesBodySchema,
  transferBodySchema,
  classIdParamSchema,
  withdrawBodySchema,
} from "./schema.js";

// ── Schemas ───────────────────────────────────────────────────────────

const EnrollmentSummaryDto = z
  .object({
    enrollmentId: z.uuid(),
    studentId: z.uuid(),
    classId: z.uuid(),
    compulsorySubjects: z.number().int(),
  })
  .openapi("EnrollmentSummaryDto");

const EnrollmentDto = z
  .object({
    id: z.uuid(),
    studentId: z.uuid(),
    classId: z.uuid(),
    sessionId: z.uuid(),
    status: z.enum(["active", "transferred", "withdrawn"]),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    endedReason: z.string().nullable(),
    transferredFromEnrollmentId: z.uuid().nullable(),
  })
  .openapi("EnrollmentDto");

const EnrollmentListResponse = z
  .object({ data: z.array(EnrollmentDto), pagination: paginationSchema })
  .openapi("EnrollmentListResponse");

const EnrollmentResponse = z
  .object({ enrollment: EnrollmentDto })
  .openapi("EnrollmentResponse");

const SelectionProblemDto = z
  .object({
    code: z.enum([
      "TOO_MANY",
      "TOO_FEW",
      "UNKNOWN_OFFERING",
      "DUPLICATE_CHOICE",
      "UNKNOWN_GROUP",
    ]),
    severity: z.enum(["blocking", "incomplete"]),
    groupId: z.uuid().nullable(),
    count: z.number().int().optional(),
    min: z.number().int().optional(),
    max: z.number().int().optional(),
    message: z.string(),
  })
  .openapi("SelectionProblemDto");

const GroupSelectionDto = z
  .object({
    groupId: z.uuid(),
    name: z.string(),
    min: z.number().int(),
    max: z.number().int(),
    count: z.number().int(),
    status: z.enum(["ok", "too_few", "too_many"]),
  })
  .openapi("GroupSelectionDto");

const ElectivesResultDto = z
  .object({
    complete: z.boolean(),
    problems: z.array(SelectionProblemDto),
    groups: z.array(GroupSelectionDto),
    active: z.number().int(),
    dropped: z.number().int(),
  })
  .openapi("ElectivesResultDto");

const BulkEnrollResponse = z
  .object({ results: z.array(EnrollmentSummaryDto) })
  .openapi("BulkEnrollResponse");

const TransferResponse = z
  .object({
    oldEnrollment: EnrollmentDto,
    newEnrollment: EnrollmentDto,
    compulsorySubjects: z.number().int(),
  })
  .openapi("TransferResponse");

const RosterEntryDto = z
  .object({
    enrollmentId: z.uuid(),
    studentId: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email().nullable(),
    admissionNumber: z.string(),
    house: z.string().nullable(),
    startedAt: z.string().datetime(),
  })
  .openapi("RosterEntryDto");

const RosterResponse = z
  .object({ data: z.array(RosterEntryDto), pagination: paginationSchema })
  .openapi("RosterResponse");

// ── Paths ─────────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/enrollments",
  tags: ["Enrollments"],
  summary: "List active enrollments in the actor's scope",
  description:
    "Requires `enrollments:read`. When `classId` is supplied, a class outside the actor's scope returns 404. Without it, the list is filtered to the actor's assigned classes; a teacher with no assignments receives an empty list. Out-of-scope is 404, not 403.",
  security: sessionSecurity,
  request: {
    query: z.object({
      classId: z.uuid().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      offset: z.coerce.number().int().nonnegative().optional(),
    }),
  },
  responses: {
    200: jsonResponse("Enrollments visible to the actor.", EnrollmentListResponse),
    400: errorResponse("Invalid query."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing enrollments:read."),
    404: errorResponse("Class is outside the actor's scope or does not exist."),
  },
});

registry.registerPath({
  method: "get",
  path: "/enrollments/{id}",
  tags: ["Enrollments"],
  summary: "Read one enrollment",
  description:
    "Requires `enrollments:read`. The enrollment is loaded first, then its class is checked against scope. Out-of-scope returns 404 ENROLLMENT_NOT_FOUND.",
  security: sessionSecurity,
  request: { params: enrollmentIdParamSchema },
  responses: {
    200: jsonResponse("Enrollment.", EnrollmentResponse),
    400: errorResponse("Invalid enrollment id."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing enrollments:read."),
    404: errorResponse("Enrollment not found or outside scope."),
  },
});

registry.registerPath({
  method: "post",
  path: "/enrollments",
  tags: ["Enrollments"],
  summary: "Enroll a student in a class",
  description:
    "Creates one active enrollment and auto-enrolls the student in every compulsory offering of the class. Refused if the student already has an active enrollment in the same session.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: enrollStudentSchema } },
    },
  },
  responses: {
    201: jsonResponse("Created", EnrollmentSummaryDto),
    400: errorResponse("Validation failure."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Class or student not found in this school."),
    409: errorResponse(
      "Class archived, session locked, or student already enrolled in this session.",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/enrollments/bulk",
  tags: ["Enrollments"],
  summary: "Bulk-enroll many students",
  description:
    "All-or-nothing. One invalid student rolls back the whole batch. Pass `dryRun: true` to preview without persisting — the same code runs, the transaction is rolled back, and the response reflects what *would* have happened (real UUIDs in the response are not persisted).",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bulkEnrollSchema } },
    },
  },
  responses: {
    200: jsonResponse("OK", BulkEnrollResponse),
    400: errorResponse("Validation failure or duplicate studentIds."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Class or a student not found."),
    409: errorResponse(
      "Class archived, session locked, or a student already enrolled.",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/enrollments/{id}/electives",
  tags: ["Enrollments"],
  summary: "Set electives for an enrollment",
  description:
    "Replaces the student's elective choices atomically. Blocking problems (TOO_MANY, unknown offering, etc.) return 409 with details; incomplete selections (TOO_FEW) are saved with `complete: false`. Compulsory and extra-subject rows are untouched.",
  security: sessionSecurity,
  request: {
    params: enrollmentIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: setElectivesBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Saved", ElectivesResultDto),
    400: errorResponse("Duplicate offeringIds."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Enrollment not found (or ended)."),
    409: errorResponse(
      "Blocking selection problems, archived class, or locked session.",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/enrollments/{id}/transfer",
  tags: ["Enrollments"],
  summary: "Transfer an enrollment to another class",
  description:
    "Ends the current enrollment (status='transferred', ended_at=now) and creates a new one in the target class. Old student_subjects rows are preserved; target compulsory subjects are auto-created. Ordering is enforced by the transaction: the old row must end before the new one inserts.",
  security: sessionSecurity,
  request: {
    params: enrollmentIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: transferBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Transferred", TransferResponse),
    400: errorResponse("Validation failure."),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Enrollment or target class not found."),
    409: errorResponse(
      "Enrollment not active, class archived, session locked, same class, or student already in the target session.",
    ),
  },
});

registry.registerPath({
  method: "post",
  path: "/enrollments/{id}/withdraw",
  tags: ["Enrollments"],
  summary: "Withdraw an enrollment",
  description:
    "Terminal state — ends the enrollment (status='withdrawn', ended_at=now, ended_reason=reason). No replacement enrollment is created. Student_subjects rows are preserved unchanged.",
  security: sessionSecurity,
  request: {
    params: enrollmentIdParamSchema,
    body: {
      required: false,
      content: { "application/json": { schema: withdrawBodySchema } },
    },
  },
  responses: {
    204: { description: "Withdrawn — no content." },
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Enrollment not found."),
    409: errorResponse(
      "Enrollment not active, class archived, session locked, or empty reason.",
    ),
  },
});

registry.registerPath({
  method: "get",
  path: "/classes/{classId}/roster",
  tags: ["Enrollments"],
  summary: "List the active roster of a class",
  description:
    "Returns every student currently enrolled in the class (active enrollments only — transferred and withdrawn students are excluded). Ordered by last name, then first name. Read-only; no writes, no audit.",
  security: sessionSecurity,
  request: { params: classIdParamSchema },
  responses: {
    200: jsonResponse("OK", RosterResponse),
    401: errorResponse("Not authenticated."),
    403: errorResponse("Insufficient permission."),
    404: errorResponse("Class not found in this school."),
  },
});
