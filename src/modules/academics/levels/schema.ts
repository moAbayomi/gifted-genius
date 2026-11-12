import { z } from "zod";

export const createLevelSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    sequence: z.int().positive().max(32767),
    stage: z.enum(["junior", "senior"]),
  })
  .strict();

export type CreateLevelInput = z.infer<typeof createLevelSchema>;

export const updateLevelSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sequence: z.int().positive().max(32767).optional(),
    stage: z.enum(["junior", "senior"]).optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.name !== undefined || d.sequence !== undefined || d.stage !== undefined,
    { message: "At least one field must be provided" },
  );

export type UpdateLevelInput = z.infer<typeof updateLevelSchema>;

export const listLevelsQuerySchema = z
  .object({
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .strict();

export type ListLevelsQuery = z.infer<typeof listLevelsQuerySchema>;

export const levelIdParamSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export type LevelIdParam = z.infer<typeof levelIdParamSchema>;
