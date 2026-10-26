import type { DbExecutor } from "../../db/types.js";
import { AppError } from "../../shared/lib/errors.js";
import type { Actor } from "../rbac/can.js";
import { encodeCursor } from "./dto.js";
import { listAuditRows, type AuditFilters } from "./repository.js";
import { decodeCursor, type ListAuditQuery } from "./schema.js";

export interface ListAuditResult {
  rows: Awaited<ReturnType<typeof listAuditRows>>["rows"];
  nextCursor: string | null;
}

export async function listAuditLog(
  executor: DbExecutor,
  actor: Actor,
  query: ListAuditQuery,
) {
  let cursor;
  try {
    cursor = decodeCursor(query.cursor);
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "Cursor is malformed");
  }

  const filters: AuditFilters = {
      action: query.action,
      targetType: query.targetType,
      targetId: query.targetId,
      actorMembershipId: query.actorMembershipId,
      from: query.from,
      to: query.to,
    };
  
  const { rows, hasNextPage } = await listAuditRows(
    executor,
    actor.schoolId,
    { limit: query.limit, offset: 0 },
    filters,
    cursor,
  );

  const nextCursor =
    hasNextPage && rows.length > 0
      ? encodeCursor(rows[rows.length - 1]!)
      : null;

  return { rows, nextCursor };
}
