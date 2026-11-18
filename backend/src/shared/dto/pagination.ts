import { z } from "zod";

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

// ── 1. Zod Schemas (for Route Validation & OpenAPI) ──────────────

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().min(1).optional(),
});

export const paginationMetaSchema = z.object({
  limit: z.number().int(),
  offset: z.number().int().optional(),
  total: z.number().int().optional(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});

export function paginatedResponse<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    pagination: paginationMetaSchema,
  });
}

// ── 2. Types & Helpers ───────────────────────────────────────────

export type PaginationDto = z.infer<typeof paginationMetaSchema>;

export interface PaginatedDto<T> {
  data: T[];
  pagination: PaginationDto;
}

export interface PageQuery {
  limit: number;
  offset: number;
}

/** Clamps limit to [1, 100] with default 25, and offset to >= 0. */
export function parsePageQuery(query: {
  limit?: unknown;
  offset?: unknown;
}): PageQuery {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);

  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const offset =
    Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

/** Build envelope for offset-based endpoints (users, roles, classes, etc.). */
export function toPaginatedDto<T>(
  data: T[],
  { limit, offset, total }: { limit: number; offset: number; total: number },
): PaginatedDto<T> {
  return {
    data,
    pagination: {
      limit,
      offset,
      total,
      hasMore: offset + data.length < total,
      nextCursor: null,
    },
  };
}

/** Build envelope for cursor-based endpoints (audit log). */
export function toCursorPaginatedDto<T>(
  data: T[],
  {
    limit,
    nextCursor,
    total,
  }: { limit: number; nextCursor: string | null; total?: number },
): PaginatedDto<T> {
  return {
    data,
    pagination: {
      limit,
      ...(total !== undefined ? { total } : {}),
      hasMore: nextCursor !== null,
      nextCursor,
    },
  };
}

/** Slice an already-loaded list and build the standard pagination envelope. */
export function paginateRows<T>(
  rows: T[],
  query: { limit?: unknown; offset?: unknown },
): PaginatedDto<T> {
  const page = parsePageQuery(query);
  return toPaginatedDto(rows.slice(page.offset, page.offset + page.limit), {
    limit: page.limit,
    offset: page.offset,
    total: rows.length,
  });
}
