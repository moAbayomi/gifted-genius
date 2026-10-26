// shared/dto/pagination.ts

/** The page block of any list response. */
export interface PaginationDto {
  limit: number;
  offset: number;
  total: number;
}

/**
 * The envelope for any paginated list response.
 * Every list endpoint uses this exact shape:
 *   { data: T[], page: { limit, offset, total } }
 *
 * Frontend gets ONE shape for every list. No adapters.
 */
export interface PaginatedDto<T> {
  data: T[];
  page: PaginationDto;
}

/** Build a paginated response from a rows array + the total count. */
export function toPaginatedDto<T>(
  data: T[],
  page: PaginationDto,
): PaginatedDto<T> {
  return { data, page };
}

// ── Query param parsing ──────────────────────────────────────────

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface PageQuery {
  limit: number;
  offset: number;
}

/**
 * Parse and clamp pagination query params.
 *   ?limit=50&offset=100  → { limit: 50, offset: 100 }
 *   ?limit=999            → { limit: 100, offset: 0 }  (clamped to max)
 *   (no params)           → { limit: 20, offset: 0 }   (defaults)
 *
 * Never trust user-supplied limit. Clamping prevents a client from
 * requesting 1,000,000 rows and DOSing the server.
 */
export function parsePageQuery(query: {
  limit?: unknown;
  offset?: unknown;
}): PageQuery {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);

  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const offset = Number.isFinite(rawOffset) && rawOffset > 0
    ? Math.floor(rawOffset)
    : 0;

  return { limit, offset };
}