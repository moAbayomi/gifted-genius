import { z } from "zod";
import { paginationQuerySchema } from "../../../shared/dto/pagination.js";

const offeringInputSchema = z
  .object({
    subjectId: z.uuid(),
    isCompulsory: z.boolean(),
    electiveGroupId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine(
    (d) =>
      !d.isCompulsory ||
      d.electiveGroupId === undefined ||
      d.electiveGroupId === null,
    { message: "A compulsory offering cannot belong to an elective group" },
  );

export const addOfferingsSchema = z
  .object({
    subjects: z.array(offeringInputSchema).min(1),
  })
  .strict();

export type AddOfferingsInput = {
  classId: string;
  subjects: z.infer<typeof addOfferingsSchema>["subjects"];
};

export const listOfferingsQuerySchema = z
  .object({
    includeArchived: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .merge(paginationQuerySchema.pick({ limit: true, offset: true }))
  .strict();

export interface ListOfferingsQuery {
  classId: string;
  includeArchived: boolean;
}

export const classIdParamSchema = z.object({ classId: z.uuid() }).strict();

export const offeringIdParamSchema = z.object({ id: z.uuid() }).strict();
