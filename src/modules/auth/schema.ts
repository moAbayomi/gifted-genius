// modules/auth/schema.ts
//
// Request schemas for the auth module, extracted from routes.ts so the
// OpenAPI registry can reuse them. This file imports the registry (which runs
// extendZodWithOpenApi) before defining anything that calls `.openapi(...)`.
import { z } from "zod";
import { PERMISSIONS } from "../rbac/permissions.js";
import "../../openapi/registry.js";

// ── Requests ─────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z
    .string()
    .email()
    .openapi({ description: "Account email", example: "owner@demo.test" }),
  password: z
    .string()
    .min(1)
    .openapi({ description: "Account password", example: "demo-password-1234" }),
  schoolSlug: z
    .string()
    .optional()
    .openapi({
      description:
        "Only needed when the same email belongs to several schools. Omit it on the first call; if the user has more than one active membership the response is `kind: select_school`, and the client retries with a slug.",
      example: "demo",
    }),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1)
    .openapi({ description: "The password currently in use" }),
  newPassword: z
    .string()
    .min(10)
    .openapi({ description: "At least 10 characters; must differ from the current password" }),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

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
    }),
    school: z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
    }),
    roles: z
      .array(z.string())
      .openapi({ description: "Role keys held at the active school", example: ["owner"] }),
    permissions: z
      .array(z.enum(PERMISSIONS))
      .openapi({ description: "Effective permission set (union of all roles)" }),
    mustChangePassword: z.boolean(),
  })
  .openapi("MeResponse");
