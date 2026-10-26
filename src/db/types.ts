// db/types.ts
import type { db } from "./client.js";

export type DbClient = typeof db;

/** A transaction handle. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Anything that can run a query — either the base client or a transaction.
 * Use this for helpers that should work in both contexts (read-only
 * queries are usually safe to run outside a transaction, but passing
 * `tx` is required when the caller is mid-transaction and needs the
 * helper to see uncommitted state).
 */
export type DbExecutor = DbClient | Tx;