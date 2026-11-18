// db/utils/assert.ts

/**
 * Extract exactly one row from a `.returning()` result.
 * Throws if the array is empty — a `.returning()` that returns zero rows
 * means the insert/update didn't actually run, which is a DB-level bug
 * we should surface, not silently tolerate.
 */
export function one<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(
      "Expected one row from .returning() but got none — check DB connection / transaction state",
    );
  }
  return row;
}

/**
 * Look up a key in a map we populated ourselves.
 * Use for maps where a missing key means a bug (e.g. we just inserted all
 * the keys), not a normal "not found" case. For user-supplied lookups,
 * use map[key] and handle undefined explicitly.
 */
export function mustGet<K extends string, V>(
  map: Record<K, V>,
  key: K,
  context?: string,
): V {
  const v = map[key];
  if (v === undefined) {
    throw new Error(
      `Expected key '${key}' to be present${context ? ` (${context})` : ""}`,
    );
  }
  return v;
}