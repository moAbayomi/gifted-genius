import { z } from "zod";

// Trim + min(1) so empty/whitespace codes are rejected at the boundary.
// Uppercase happens in the service (Zod can't transform to uppercase without
// losing the .trim() ordering guarantee across versions).
const codeSchema = z.string().trim().min(1).max(20);
const nameSchema = z.string().trim().min(1).max(100);

export const createSubjectSchema = z
  .object({
    code: codeSchema,
    name: nameSchema,
  })
  .strict();

export const updateSubjectSchema = z
  .object({
    code: codeSchema.optional(),
    name: nameSchema.optional(),
  })
  .strict()
  .refine((d) => d.code !== undefined || d.name !== undefined, {
    message: "At least one of code or name is required",
  });

export const listSubjectsQuerySchema = z
  .object({
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .strict();

export const subjectIdParamSchema = z.object({ id: z.uuid() }).strict();

export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;
export type SubjectIdParam = z.infer<typeof subjectIdParamSchema>;