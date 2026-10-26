// modules/audit/schema.ts
import { z } from "zod";

const cursorPayloadSchema = z.object({
  // Accept ISO with microseconds OR standard datetime strings.
  // The exact format from Postgres is: "2024-10-25 10:30:15.123456+00"
  createdAt: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}[+-]\d{2}(:\d{2})?$/,
      "Invalid cursor timestamp",
    ),
  id: z.uuid("Invalid cursor id"),
});

export function decodeCursor(raw: string | undefined) {
  if (!raw) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString());
    return cursorPayloadSchema.parse(decoded);
  } catch {
    throw new Error("invalid cursor"); // route translates to 400
  }
}

export const listAuditQuerySchema = z
  .object({
    limit: z.coerce.number().int().positive().max(100).default(25),
    cursor: z.string().optional(),
    action: z.string().trim().min(1).max(100).optional(),
    targetType: z.string().trim().min(1).max(50).optional(),
    targetId: z.string().trim().min(1).max(100).optional(),
    actorMembershipId: z.uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;