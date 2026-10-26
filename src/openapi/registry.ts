// src/openapi/registry.ts
//
// Single entry point for the OpenAPI registry.
//
// `extendZodWithOpenApi(z)` MUST run before any schema calls `.openapi(...)`.
// Every module's `openapi.ts` imports this file before importing its schemas,
// and `src/openapi/document.ts` imports this file first as well. Keep that
// order: a schema created before the extension lacks the `.openapi` method.
import { z } from "zod";
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export { z };

/** The one registry every module registers its paths and components into. */
export const registry = new OpenAPIRegistry();

// ── Shared response components ───────────────────────────────────

/** Every error response in the API has this envelope. */
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "FORBIDDEN" }),
      message: z.string().openapi({ example: "Missing permission: users:create" }),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorResponse");

/** Acknowledgement body used by mutating endpoints that return no resource. */
export const okResponseSchema = z
  .object({ ok: z.literal(true) })
  .openapi("OkResponse");

/** Page block shared by every offset-paginated list. */
export const paginationSchema = z
  .object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .openapi("Pagination");

/**
 * `{ data, page }` envelope. `name` becomes the component name, so each list
 * gets its own concrete schema rather than a generic with no runtime meaning.
 */
export function paginatedSchema<Item extends z.ZodType>(
  name: string,
  item: Item,
) {
  return z
    .object({ data: z.array(item), page: paginationSchema })
    .openapi(name);
}

/** `{ data }` envelope for lists that are not paginated. */
export function dataListSchema<Item extends z.ZodType>(
  name: string,
  item: Item,
) {
  return z.object({ data: z.array(item) }).openapi(name);
}

/** Build a JSON response entry for `registerPath`. */
export function jsonResponse<Schema extends z.ZodType>(
  description: string,
  schema: Schema,
) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** The standard error response entry, repeated per status code. */
export function errorResponse(description: string) {
  return jsonResponse(description, errorResponseSchema);
}

/** Register shared components exactly once. */
registry.register("ErrorResponse", errorResponseSchema);
registry.register("OkResponse", okResponseSchema);
registry.register("Pagination", paginationSchema);

// ── Security ─────────────────────────────────────────────────────

/**
 * The session cookie. Swagger UI's Authorize button cannot set cookies, but
 * when /docs is served from the API origin, calling POST /auth/login inside
 * Swagger UI sets the cookie and subsequent "Try it out" calls carry it.
 */
registry.registerComponent("securitySchemes", "session", {
  type: "apiKey",
  in: "cookie",
  name: "session",
  description:
    "Opaque session cookie set by `POST /auth/login`. httpOnly; the raw token is never exposed to JavaScript. Log in via Swagger UI first, then use Try it out.",
});

export const sessionSecurity = [{ session: [] }];

// ── Tag descriptions ─────────────────────────────────────────────

export const tags = [
  {
    name: "Auth",
    description:
      "Login, logout, password change, and the current identity. Login is email + password only; a user with several active memberships gets a school picker before a session is created.",
  },
  {
    name: "Users",
    description:
      "Members of the caller's school. Every `:id` is a **membership** ID, never a global user ID. Requires `users:*` permissions; destructive actions also require a strictly higher rank than the target.",
  },
  {
    name: "Roles",
    description:
      "Per-school roles and their permission grants. Requires `roles:read`, `roles:assign`, or `roles:manage_permissions`. The owner role is locked.",
  },
  {
    name: "Audit",
    description:
      "Append-only, school-scoped audit history. Requires `audit:read`. Cursor-paginated by `(created_at, id)`.",
  },
  {
    name: "System",
    description: "Liveness and documentation endpoints.",
  },
];

/** Reusable path parameter schema for a membership ID. */
export const membershipIdParams = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path", description: "Membership ID" },
    example: "6f0c3b7e-2a63-4a5e-9f0e-0f6a2c9b1d42",
  }),
});
