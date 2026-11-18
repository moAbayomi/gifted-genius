import { z } from "zod";

const sessionLabel = z
  .string()
  .trim()
  .regex(/^[0-9]{4}\/[0-9]{4}$/, "Session label must be YYYY/YYYY");

export const createAcademicSessionSchema = z
  .object({ label: sessionLabel })
  .strict();

export const updateAcademicSessionSchema = z
  .object({ label: sessionLabel })
  .strict();

export type CreateAcademicSessionInput = z.infer<
  typeof createAcademicSessionSchema
>;
export type UpdateAcademicSessionInput = z.infer<
  typeof updateAcademicSessionSchema
>;

export const rolloverSessionSchema = z
  .object({ toSessionId: z.uuid() })
  .strict();

export type RolloverSessionInput = z.infer<typeof rolloverSessionSchema>;
