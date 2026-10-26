// modules/roles/openapi.ts
//
// Role response schemas and path registration. Requests reuse
// roles/schema.ts (assignRoleSchema, updateRolePermissionsSchema).
import {
  dataListSchema,
  errorResponse,
  jsonResponse,
  membershipIdParams,
  okResponseSchema,
  registry,
  sessionSecurity,
  z,
} from "../../openapi/registry.js";
import {
  assignRoleSchema,
  updateRolePermissionsSchema,
} from "./schema.js";

// ── Response components ──────────────────────────────────────────

export const roleDtoSchema = z
  .object({
    id: z.uuid(),
    key: z.string().openapi({ example: "teacher" }),
    name: z.string().openapi({ example: "Teacher" }),
    description: z.string().nullable(),
    rank: z
      .number()
      .int()
      .openapi({ description: "1–100; higher is more authority. The client uses this to hide unassignable roles." }),
    isSystem: z.boolean(),
  })
  .openapi("Role");

export const roleDetailDtoSchema = roleDtoSchema
  .extend({ permissions: z.array(z.string()) })
  .openapi("RoleDetail");

export const roleListResponseSchema = dataListSchema(
  "RoleListResponse",
  roleDtoSchema,
);

const roleIdParams = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path", description: "Role ID" },
  }),
});

// ── Paths ────────────────────────────────────────────────────────

registry.registerPath({
  method: "get",
  path: "/roles",
  tags: ["Roles"],
  summary: "List roles at this school",
  description:
    "Requires `roles:read`. Returns every role defined for the caller's school, ordered by rank ascending. " +
    "Roles are per-school rows; the list can differ from another school's. Permission arrays are omitted here " +
    "and loaded only by the role-detail edit response.",
  security: sessionSecurity,
  responses: {
    200: jsonResponse("Roles at this school.", roleListResponseSchema),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `roles:read`."),
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{id}/roles",
  tags: ["Roles"],
  summary: "Assign a role to a member",
  description:
    "Requires `roles:assign`. `{id}` is a membership ID. The caller must hold a strictly higher rank than the " +
    "target **and** than the role, and must hold every permission the role grants (you cannot grant a " +
    "capability you lack). Self-assignment is forbidden. Idempotent: re-assigning a held role is a no-op.",
  security: sessionSecurity,
  request: {
    params: membershipIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: assignRoleSchema } },
    },
  },
  responses: {
    200: jsonResponse("Role assigned (or already held).", okResponseSchema),
    400: errorResponse("Validation failure or unknown role key."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing `roles:assign`, rank too low, permission subset violation, or self-target."),
    404: errorResponse("No such member or role in this school."),
  },
});

registry.registerPath({
  method: "put",
  path: "/roles/{id}/permissions",
  tags: ["Roles"],
  summary: "Replace a role's permission set",
  description:
    "Requires `roles:manage_permissions`. The caller must outrank the role. Every permission in the new set " +
    "must be one the caller holds — otherwise permission editing becomes a privilege-escalation path. Removing " +
    "permissions is always allowed. The **owner** role is immutable: its permissions always equal the full " +
    "catalogue, so a school cannot make itself unadministrable. The response includes the updated permissions.",
  security: sessionSecurity,
  request: {
    params: roleIdParams,
    body: {
      required: true,
      content: { "application/json": { schema: updateRolePermissionsSchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated role with its permission set.", roleDetailDtoSchema),
    400: errorResponse("Unknown permission string, duplicates, or empty set."),
    401: errorResponse("No live session."),
    403: errorResponse("Missing permission, rank too low, owner role, or granting a permission the caller lacks."),
    404: errorResponse("No such role in this school."),
  },
});
