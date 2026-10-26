// modules/audit/dto.ts
import type { AuditRow } from "./repository.js";

export interface AuditRowDto {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  actor: { name: string; membershipId: string | null };
  metadata: { via?: string; roleKey?: string };
}

export interface AuditListResponseDto {
  data: AuditRowDto[];
  /** Opaque cursor for the next page. Null when there are no more rows. */
  nextCursor: string | null;
}

export function toAuditRowDto(row: AuditRow): AuditRowDto {
  return {
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before: row.before,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
    actor:
      row.actorFirst && row.actorLast
        ? {
            name: `${row.actorFirst} ${row.actorLast}`,
            membershipId: row.actorMembershipId,
          }
        : { name: "System", membershipId: null },
    // Conditional spread: the key is only present when the value is
    // a real string. `{ ...(false) }` spreads nothing — the key is
    // truly absent, matching `via?: string` exactly.
    metadata: {
      ...(typeof row.metadata?.via === "string" && { via: row.metadata.via }),
      ...(typeof row.metadata?.roleKey === "string" && { roleKey: row.metadata.roleKey }),
    },
  };
}

/**
 * Encode the cursor from the last row of the current page.
 * Uses createdAtText (microsecond-precision string), never createdAt (Date).
 */
export function encodeCursor(row: AuditRow): string {
  const payload = JSON.stringify({ createdAt: row.createdAtText, id: row.id });
  return Buffer.from(payload).toString("base64url");
}