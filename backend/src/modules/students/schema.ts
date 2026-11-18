import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._-]{3,40}$/,
    "Username must be 3-40 chars: lowercase letters, digits, dot, underscore, or hyphen",
  );

/**
 * Create-student request body.
 *
 * A student must be able to log in. Email is preferred; a student without an
 * email must have a username. Admitted students always have an admission
 * number, unique within the school.
 */
export const createStudentSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().optional(),
    username: usernameSchema.optional(),
    admissionNumber: z.string().trim().min(1).max(50),
    house: z.string().trim().max(100).optional(),
    admissionDate: z
      .string()
      .trim()
      .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Date must be YYYY-MM-DD")
      .optional(),
  })
  .strict()
  .refine((d) => d.email !== undefined || d.username !== undefined, {
    message: "A student without an email must have a username",
    path: ["username"],
  });

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
