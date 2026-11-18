// modules/users/openapi.ts
//
// Response schemas + path registration for member management. The request
// schemas come from ./schema.ts, so routes, docs, and tests share them.
import {
  errorResponse,
  jsonResponse,
  membershipIdParams,
  okResponseSchema,
  paginatedSchema,
  registry,
  sessionSecurity,
  z,
} from "../../openapi/registry.js";
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
} from "./schema.js";

// ── Response components ──────────────────────────────────────────

/** A person's relationship with one school. `id` is the membership ID. */
export const memberDtoSchema = z
  .object({
    id: z.uuid().openapi({ description: "Membership ID (not the global user ID)" }),
    username: z.string().nullable(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.email().nullable(),
    phone: z.string().nullable(),
    status: z.enum(["active", "inactive", "suspended"]),
    roles: z.array(z.string()).openapi({ description: "Role keys held at this school" }),
    joinedAt: z.iso.datetime(),
  })
  .openapi("Member");

export const createUserResponseSchema = z
  .object({
    user: memberDtoSchema,
    temporaryPassword: z
      .string()
      .optional()
      .openapi({
        description:
          "Present only when a NEW user was created. Absent when an existing user was linked to this school. Known low-severity enumeration vector; see SECURITY.md.",
      }),
  })
  .openapi("CreateUserResponse");

export const memberListResponseSchema = paginatedSchema(
  "MemberListResponse",
  memberDtoSchema,
);

const roleIdParam = z.uuid().openapi({
  param: { name: "roleId", in: "path", description: "Role ID" },
});

const memberAndRoleParams = z.object({
  id: membershipIdParams.shape.id,
  roleId: roleIdParam,
});

const pageQuerySchema = listUsersQuerySchema;

// ── Paths ────────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/users",
  tags: ["Users"],
  summary: "Invite a member to this school",
  description:
    "Requires `users:create`. Creates a user (returning a one-time `temporaryPassword`) or links an existing " +
    "user to this school without one. Every requested role must be ranked strictly below the caller and grant " +
    "only permissions the caller holds. At least one of `email` or `username` is required. The actor cannot " +
    "assign a role at or above their own rank. Body is `.strict()`: unknown fields are rejected.",
  security: sessionSecurity,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createUserSchema } },
    },
  },
  responses: {
    201: jsonResponse("Member created or linked.", createUserResponseSchema),
    400: errorResponse("Validation failure, or a role key that does not exist at this school (`UNKNOWN_ROLE`)."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `users:create`, or a role the caller cannot assign."),
    409: errorResponse("Already a member (`ALREADY_MEMBER`) or username taken at this school (`USERNAME_TAKEN`)."),
  },
});

registry.registerPath({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "List members of this school",
  description:
    "Requires `users:read`. Offset-paginated; `limit` is clamped to 100 by the server. Ordered by newest " +
    "membership first with `id` as a tiebreaker.",
  security: sessionSecurity,
  request: { query: pageQuerySchema },
  responses: {
    200: jsonResponse("A page of members.", memberListResponseSchema),
    400: errorResponse("Unknown or invalid query parameter."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `users:read`."),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Get one member",
  description:
    "Requires `users:read`. `{id}` is a membership ID. A membership in another school returns the same " +
    "`404 NOT_FOUND` as a nonexistent one — no cross-school probing.",
  security: sessionSecurity,
  request: { params: membershipIdParams },
  responses: {
    200: jsonResponse("The member.", memberDtoSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `users:read`."),
    404: errorResponse("No such member in this school."),
  },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  tags: ["Users"],
  summary: "Update a member's profile",
  description:
    "Requires `users:update`. Requires a strictly higher rank than the target, and rejects self-targeting " +
    "(use `/me`). Email changes are refused for users who belong to another school (`SHARED_ACCOUNT`), " +
    "because one school must not be able to take over an identity used elsewhere.",
  security: sessionSecurity,
  request: {
    params: membershipIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateUserSchema } },
    },
  },
  responses: {
    200: jsonResponse("The updated member.", memberDtoSchema),
    400: errorResponse("Validation failure or empty update."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `users:update`, rank too low, or self-target."),
    404: errorResponse("No such member in this school."),
    409: errorResponse("Username taken (`USERNAME_TAKEN`) or shared account (`SHARED_ACCOUNT`)."),
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{id}/reset-password",
  tags: ["Users"],
  summary: "Reset a member's password (admin)",
  description:
    "Requires `users:reset_password` and a strictly higher rank. Sets a new password, forces a change on next " +
    "login, and deletes every session of the target. Refused for multi-school users (`SHARED_ACCOUNT`) — only " +
    "they may change their own password. Self-targeting is rejected; use `/auth/change-password`.",
  security: sessionSecurity,
  request: {
    params: membershipIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: resetPasswordSchema } },
    },
  },
  responses: {
    200: jsonResponse("Password reset; target's sessions revoked.", okResponseSchema),
    400: errorResponse("Validation failure."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing permission, rank too low, or self-target."),
    404: errorResponse("No such member in this school."),
    409: errorResponse("The user belongs to another school (`SHARED_ACCOUNT`)."),
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{id}/suspend",
  tags: ["Users"],
  summary: "Suspend a member at this school",
  description:
    "Requires `users:suspend` and a strictly higher rank. Sets the **membership** status to suspended and " +
    "deletes sessions whose active membership is this row; sessions at other schools survive. Cannot suspend " +
    "yourself. Owners cannot be suspended because no rank is strictly above theirs.",
  security: sessionSecurity,
  request: { params: membershipIdParams },
  responses: {
    200: jsonResponse("Membership suspended.", okResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing permission, rank too low, or self-target."),
    404: errorResponse("No such member in this school."),
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{id}/reactivate",
  tags: ["Users"],
  summary: "Reactivate a suspended membership",
  description:
    "Requires `users:suspend` (same capability as suspending) and a strictly higher rank. Idempotent: an " +
    "already-active membership is a no-op. No sessions are created; the member logs in again.",
  security: sessionSecurity,
  request: { params: membershipIdParams },
  responses: {
    200: jsonResponse("Membership active.", okResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing permission, rank too low, or self-target."),
    404: errorResponse("No such member in this school."),
  },
});

registry.registerPath({
  method: "delete",
  path: "/users/{id}/roles/{roleId}",
  tags: ["Users"],
  summary: "Remove a role from a member",
  description:
    "Requires `roles:assign` and a strictly higher rank. Self-targeting is rejected. Removing the owner role " +
    "is guarded by a last-owner check; through the API the self-check and strict rank mean owners cannot " +
    "remove an owner role at all. Returns 204 even when the member did not hold the role (idempotent, no audit row).",
  security: sessionSecurity,
  request: { params: memberAndRoleParams },
  responses: {
    204: { description: "Role removed (or was not held)." },
    401: errorResponse("No live session."),
    403: errorResponse("Missing `roles:assign`, rank too low, self-target, or last owner."),
    404: errorResponse("No such member or role in this school."),
  },
});
