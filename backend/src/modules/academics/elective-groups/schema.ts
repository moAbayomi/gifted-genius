import { z } from "zod";
import { paginationQuerySchema } from "../../../shared/dto/pagination.js";

const nameSchema = z.string().trim().min(1).max(100);

export const createElectiveGroupSchema = z
  .object({
    classId: z.uuid(),
    name: nameSchema,
    minChoices: z.number().int().min(0),
    maxChoices: z.number().int().min(0),
  })
  .strict();

export const updateElectiveGroupSchema = z
  .object({
    name: nameSchema.optional(),
    minChoices: z.number().int().min(0).optional(),
    maxChoices: z.number().int().min(0).optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.name !== undefined ||
      d.minChoices !== undefined ||
      d.maxChoices !== undefined,
    { message: "At least one of name, minChoices, maxChoices is required" },
  );

export const listElectiveGroupsQuerySchema = z
  .object({
    classId: z.uuid(), // required — groups are scoped to a class
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .merge(paginationQuerySchema.pick({ limit: true, offset: true }))
  .strict();

export const electiveGroupIdParamSchema = z.object({ id: z.uuid() }).strict();

export type CreateElectiveGroupInput = z.infer<typeof createElectiveGroupSchema>;
export type UpdateElectiveGroupInput = z.infer<typeof updateElectiveGroupSchema>;
export type ListElectiveGroupsQuery = z.infer<typeof listElectiveGroupsQuerySchema>;
export type ElectiveGroupIdParam = z.infer<typeof electiveGroupIdParamSchema>;