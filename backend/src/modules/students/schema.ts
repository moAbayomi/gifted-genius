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
    admissionNumber: z.string().trim().min(1).max(50).optional(),
    house: z.string().trim().max(100).optional(),
    admissionDate: z
      .string()
      .trim()
      .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Date must be YYYY-MM-DD")
      .optional(),
  })
  .strict();

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

/**
 * Student directory query. `classId` is optional: owners/principals see the
 * whole school, teachers are scoped to their assigned classes.
 */
export const listStudentsQuerySchema = z
  .object({
    classId: z.uuid().optional(),
    q: z.string().trim().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type ListStudentsQuery = z.infer<typeof listStudentsQuerySchema>;
