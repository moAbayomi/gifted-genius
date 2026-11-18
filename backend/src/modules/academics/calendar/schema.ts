// modules/academics/calendar/schema.ts
//
// Request schemas shared by the calendar routes, the OpenAPI registration,
// and the tests. Keep validation here, not inline in routes.
import { z } from "zod";
import { paginationQuerySchema } from "../../../shared/dto/pagination.js";

/** `POST /terms/:termId/close` requires an explicit confirmation. */
export const closeTermSchema = z
  .object({ confirm: z.literal(true) })
  .strict();

export type CloseTermInput = z.infer<typeof closeTermSchema>;

/** Activation also requires confirmation because it closes the active term. */
export const activateTermSchema = z
  .object({ confirm: z.literal(true) })
  .strict();

export type ActivateTermInput = z.infer<typeof activateTermSchema>;

/** `POST /sessions/:sessionId/unlock` requires a reason for the audit log. */
export const unlockSessionSchema = z
  .object({ reason: z.string().trim().min(10).max(500) })
  .strict();

export type UnlockSessionInput = z.infer<typeof unlockSessionSchema>;

export function isRealCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const isoDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Date must be YYYY-MM-DD")
  .refine(isRealCalendarDate, "Date must be a real calendar date");

export const createTermSchema = z
  .object({
    sessionId: z.uuid(),
    number: z.int().positive().max(32767),
    name: z.string().trim().min(1).max(100),
    startDate: isoDate,
    endDate: isoDate,
  })
  .strict()
  .refine((d) => d.endDate >= d.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

export const updateTermSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.name !== undefined ||
      d.startDate !== undefined ||
      d.endDate !== undefined,
    { message: "At least one field must be provided" },
  );

export type CreateTermInput = z.infer<typeof createTermSchema>;
export type UpdateTermInput = z.infer<typeof updateTermSchema>;

export const listTermsQuerySchema = z
  .object({ sessionId: z.uuid() })
  .merge(paginationQuerySchema.pick({ limit: true, offset: true }))
  .strict();
