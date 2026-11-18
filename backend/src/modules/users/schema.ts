// modules/users/schema.ts
import { z } from "zod";

/**
 * Create-user (invite-member) request body.
 *
 * .strict() rejects any unknown key — prevents mass assignment.
 * Without it, a client sending { schoolId: "other", status: "active" }
 * could overwrite fields via any spread-into-insert shortcut.
 *
 * At least one of email or username is required — otherwise the user
 * has no way to log in. Email is the primary path (staff, parents);
 * username is for students without email (username-login added later).
 *
 * NOTE: this differs from the spec version, which required username.
 * That version blocks parent invites (parents have email, no username).
 * Making username optional with the refine below handles both cases.
 */
export const createUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().optional(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9._-]{3,40}$/,
        "Username must be 3-40 chars: lowercase letters, digits, dot, underscore, or hyphen",
      )
      .optional(),
    roleKeys: z
      .array(z.string().trim().min(1).max(50))
      .min(1)
      .max(5)
      .transform((keys) => [...new Set(keys)]),
  })
  .strict()
  .refine((d) => d.email !== undefined || d.username !== undefined, {
    message: "At least one of email or username is required",
    path: ["email"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;

/**
 * Admin-issued replacement password.
 * POST /users/:id/reset-password
 */
export const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .max(128),
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;


/**
 * GET /users query params.
 * Real parsing/clamping is done by parsePageQuery() — this schema just
 * validates shape and documents what's accepted. Add future filters
 * (status, roleKey) here.
 */
export const listUsersQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// modules/users/schema.ts
export const updateUserSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,40}$/)
      .optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.firstName !== undefined ||
      d.lastName !== undefined ||
      d.phone !== undefined ||
      d.email !== undefined ||
      d.username !== undefined,
    { message: "At least one field must be provided" },
  );

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
