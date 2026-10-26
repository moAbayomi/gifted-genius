// src/shared/errors/pg-errors.ts

/**
 * Walk the `.cause` chain looking for a Postgres error with the given
 * unique-violation constraint. Drizzle wraps pg errors in DrizzleQueryError;
 * the `code` and `constraint` live on the inner error, not the outer one.
 *
 * Walking the chain (not just one level) is defensive — Drizzle could wrap
 * multiple times in some paths, and this costs nothing.
 */
export function isUniqueViolation(err: unknown, constraintName: string): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const e = current as { code?: string; constraint?: string; cause?: unknown };
    if (e.code === "23505" && e.constraint === constraintName) return true;
    current = e.cause;
  }
  return false;
}

export function isForeignKeyViolation(err: unknown, constraintName: string): boolean {
  let current: unknown = err;
  while (current && typeof current === "object") {
    const e = current as { code?: string; constraint?: string; cause?: unknown };
    if (e.code === "23503" && e.constraint === constraintName) return true;
    current = e.cause;
  }
  return false;
}
