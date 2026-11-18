// modules/audit/repository.ts
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import { auditLog, memberships, users } from "../../db/schema/index.js";
import type { PageQuery } from "../../shared/dto/pagination.js";

/**
 * The joined row produced by the list query. NOT the raw audit_log row —
 * includes the actor's name (from users, via memberships LEFT JOIN) and
 * the microsecond-safe `createdAtText` used for the cursor.
 *
 * The DTO consumes this shape. The raw `AuditLog` type (from `$inferSelect`)
 * is what the table row looks like — it has `actorMembershipId` but not
 * `actorFirst`/`actorLast`, because those come from the join.
 */
export interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  actorMembershipId: string | null;
  createdAt: Date;
  /** Microsecond-precision text, for the cursor. Never parse to Date. */
  createdAtText: string;
  actorFirst: string | null;
  actorLast: string | null;
}

// modules/audit/repository.ts

export interface AuditFilters {
  action?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  actorMembershipId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}


export interface AuditCursor {
  createdAt: string; // text, microsecond precision
  id: string; // UUID
}

export interface ListAuditResult {
  rows: AuditRow[];
  /** Whether a next page exists. Derived from fetching limit+1 rows. */
  hasNextPage: boolean;
}

/**
 * List audit rows for a school, newest first, with cursor pagination.
 *
 * Fetches limit+1 rows. If we got limit+1, there's a next page — the
 * extra row is dropped before returning. This is the standard "peek"
 * trick: one extra row tells you whether to show a "next" button without
 * a separate COUNT query.
 */
export async function listAuditRows(
  executor: DbExecutor,
  schoolId: string,
  page: PageQuery,
  filters: AuditFilters,
  cursor?: AuditCursor,
): Promise<ListAuditResult> {
  const rows = await executor
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      before: auditLog.before,
      after: auditLog.after,
      metadata: auditLog.metadata,
      actorMembershipId: auditLog.actorMembershipId,
      createdAt: auditLog.createdAt,
      // The microsecond trap: JS Date truncates to ms. Select the
      // raw text so the cursor carries full microsecond precision.
      createdAtText: sql<string>`${auditLog.createdAt}::text`,
      actorFirst: users.firstName,
      actorLast: users.lastName,
    })
    .from(auditLog)
    // LEFT JOIN: system actions have actorMembershipId = null.
    // INNER JOIN would silently drop them — the log would lie.
    .leftJoin(memberships, eq(memberships.id, auditLog.actorMembershipId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(auditLog.schoolId, schoolId), // ← always first
        filters.action ? eq(auditLog.action, filters.action) : undefined,
        filters.targetType
          ? eq(auditLog.targetType, filters.targetType)
          : undefined,
        filters.targetId ? eq(auditLog.targetId, filters.targetId) : undefined,
        filters.actorMembershipId
          ? eq(auditLog.actorMembershipId, filters.actorMembershipId)
          : undefined,
        filters.from ? gte(auditLog.createdAt, filters.from) : undefined,
        filters.to ? lte(auditLog.createdAt, filters.to) : undefined,
        cursor
          ? sql`(${auditLog.createdAt}, ${auditLog.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(page.limit + 1); // peek: one extra row

  const hasNextPage = rows.length > page.limit;
  const pageRows = hasNextPage ? rows.slice(0, page.limit) : rows;

  return { rows: pageRows, hasNextPage };
}
