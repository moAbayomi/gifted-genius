// modules/auth/schema.ts
//
// Request schemas for the auth module, extracted from routes.ts so the
// OpenAPI registry can reuse them. This file imports the registry (which runs
// extendZodWithOpenApi) before defining anything that calls `.openapi(...)`.
import { z } from "zod";
import { PERMISSIONS } from "../rbac/permissions.js";
import "../../openapi/registry.js";

// ── Requests ─────────────────────────────────────────────────────

export const loginSchema = z
  .object({
    email: z.string().email().max(200).optional().openapi({
      description:
        "Email login. Mutually exclusive with `username` — provide exactly one.",
      example: "owner@demo.test",
    }),
    username: z.string().trim().min(3).max(50).optional().openapi({
      description:
        "Username login (used by students without email). Requires `schoolSlug` — usernames are unique per school.",
      example: "jss1-2026-001",
    }),
    password: z.string().min(1).max(200).openapi({
      description: "Account password.",
      example: "demo-password-1234",
    }),
    schoolSlug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .openapi({
        description:
          "Required when using `username` — identifies which school's username namespace to search. " +
          "Optional when using `email` — omit on the first call; if the user has more than one active " +
          "membership the response is `kind: select_school`, and the client retries with a slug.",
        example: "demo",
      }),
  })
  .strict()
  .refine((d) => (d.email !== undefined) !== (d.username !== undefined), {
    message: "Provide exactly one of email or username",
  })
  .refine((d) => d.username === undefined || d.schoolSlug !== undefined, {
    message: "schoolSlug is required when logging in with a username",
  })
  .transform((d) => ({
    email: d.email?.trim().toLowerCase(),
    username: d.username?.trim().toLowerCase(),
    schoolSlug: d.schoolSlug?.trim().toLowerCase(),
    password: d.password,
  }));

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1)
    .openapi({ description: "The password currently in use" }),
  newPassword: z.string().min(10).openapi({
    description:
      "At least 10 characters; must differ from the current password",
  }),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const changeUsernameSchema = z
  .object({
    currentPassword: z.string().min(1),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9._-]{3,40}$/,
        "Username must be 3-40 chars: lowercase letters, digits, dot, underscore, or hyphen",
      ),
  })
  .strict();

// ── Responses ────────────────────────────────────────────────────

export const loginSuccessSchema = z
  .object({
    kind: z.literal("success"),
    user: z.object({ id: z.uuid() }),
    school: z.object({ id: z.uuid() }),
    membership: z.object({ id: z.uuid() }),
  })
  .openapi("LoginSuccess");

export const selectSchoolSchema = z
  .object({
    kind: z.literal("select_school"),
    schools: z.array(
      z.object({
        slug: z.string().openapi({ example: "demo" }),
        name: z.string().openapi({ example: "Demo Grammar School, Osogbo" }),
      }),
    ),
  })
  .openapi("LoginSelectSchool");

/**
 * 200 has two shapes: `success` (session cookie set) or `select_school`
 * (no session created; retry with `schoolSlug`).
 */
export const loginResponseSchema = z
  .discriminatedUnion("kind", [loginSuccessSchema, selectSchoolSchema])
  .openapi("LoginResponse");

export const meResponseSchema = z
  .object({
    user: z.object({
      id: z.uuid(),
      email: z.email().nullable(),
      firstName: z.string(),
      lastName: z.string(),
      username: z.string().nullable(),
    }),
    school: z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
    }),
    roles: z.array(z.string()).openapi({
      description: "Role keys held at the active school",
      example: ["owner"],
    }),
    permissions: z.array(z.enum(PERMISSIONS)).openapi({
      description: "Effective permission set (union of all roles)",
    }),
    mustChangePassword: z.boolean(),
    session: z
      .object({ id: z.uuid(), label: z.string() })
      .nullable(),
    activeTerm: z
      .object({
        id: z.uuid(),
        name: z.string(),
        number: z.number().int(),
        startDate: z.iso.date(),
        endDate: z.iso.date(),
        status: z.enum(["planned", "active", "closed"]),
      })
      .nullable(),
  })
  .openapi("MeResponse");
