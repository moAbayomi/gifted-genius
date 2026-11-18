import { z } from "zod";

export const enrollStudentSchema = z
  .object({
    studentId: z.uuid(),
    classId: z.uuid(),
  })
  .strict();

export type EnrollStudentInput = z.infer<typeof enrollStudentSchema>;

export const bulkEnrollSchema = z
  .object({
    classId: z.uuid(),
    studentIds: z.array(z.uuid()).min(1),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type BulkEnrollInput = z.infer<typeof bulkEnrollSchema>;

export const setElectivesBodySchema = z
  .object({
    offeringIds: z.array(z.uuid()),
  })
  .strict();
export type SetElectivesBody = z.infer<typeof setElectivesBodySchema>;

export const transferBodySchema = z
  .object({
    targetClassId: z.uuid(),
  })
  .strict();

export type TransferBody = z.infer<typeof transferBodySchema>;

export const withdrawBodySchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .default({});

export type WithdrawBody = z.infer<typeof withdrawBodySchema>;

export const enrollmentIdParamSchema = z.object({ id: z.uuid() }).strict();

export const classIdParamSchema = z.object({ classId: z.uuid() }).strict();

export const listEnrollmentsQuerySchema = z
  .object({
    classId: z.uuid().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuerySchema>;
