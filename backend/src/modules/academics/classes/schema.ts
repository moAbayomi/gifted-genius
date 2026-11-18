import { z } from "zod";
import { paginationQuerySchema } from "../../../shared/dto/pagination.js";

export const createClassSchema = z
  .object({
    sessionId: z.uuid(),
    levelId: z.uuid(),
    armLabel: z.string().trim().min(1).max(20),
    track: z
      .enum(["general", "science", "arts", "commercial"])
      .default("general"),
  })
  .strict();

export type CreateClassInput = z.infer<typeof createClassSchema>;

export const updateClassSchema = z
  .object({
    armLabel: z.string().trim().min(1).max(20).optional(),
    track: z.enum(["general", "science", "arts", "commercial"]).optional(),
  })
  .strict()
  .refine((d) => d.armLabel !== undefined || d.track !== undefined, {
    message: "At least one field must be provided",
  });

export type UpdateClassInput = z.infer<typeof updateClassSchema>;

export const listClassesQuerySchema = z
  .object({
    sessionId: z.uuid(),
    levelId: z.uuid().optional(),
    track: z.enum(["general", "science", "arts", "commercial"]).optional(),
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .merge(paginationQuerySchema.pick({ limit: true, offset: true }))
  .strict();

export type ListClassesQuery = z.infer<typeof listClassesQuerySchema>;

export const classIdParamSchema = z
  .object({
    id: z.uuid(),
  })
  .strict();

export type ClassIdParam = z.infer<typeof classIdParamSchema>;

export const cloneClassesSchema = z
  .object({
    fromSessionId: z.uuid(),
    toSessionId: z.uuid(),
  })
  .strict();

export type CloneClassesInput = z.infer<typeof cloneClassesSchema>;
