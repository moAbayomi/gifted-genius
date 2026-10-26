// db/audit/record.ts
import { auditLog } from "../../db/schema/audit-log.js";
import type { Tx } from "../../db/types.js";

export interface RecordAuditInput {
  /** Null for platform actions (migrations, seeds, cron). */
  schoolId: string | null;

  /** Null for system actions. When set, schoolId must also be set. */
  actorMembershipId: string | null;

  /** Convention: "resource.action", past tense. e.g. "user.created", "role.assigned". */
  action: string;

  /** The conceptual table the event is about. e.g. "school", "user", "role". */
  targetType: string;

  /** Primary key of the target entity. Null for events with no specific target. */
  targetId: string | null;

  /**
   * Snapshot of the FIELDS THAT MATTER for this event — never the whole row.
   * Always hand-pick fields. Never spread a user/credential row.
   * Redact or omit: passwordHash, tokens, secret material, session data.
   *
   * For a school: { name, slug, type, status } — the fields someone would ask
   * "what changed?" about. Not `id` (the targetId covers it), not `createdAt`
   * (timestamps in the audit row cover it), not PII that doesn't belong in
   * an audit trail.
   */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;

  /** Free-form context (IP, user agent, request id). Not queried in MVP. */
  metadata?: Record<string, unknown>;
}

/**
 * Insert one audit row. Must be called inside the SAME transaction as the
 * mutation it records — otherwise a rolled-back mutation can leave an
 * orphaned audit row, or a successful mutation can be missing its audit.
 *
 * The `tx` type is `any` for MVP. Derive it from Drizzle's transaction API
 * later if strict typing is worth the noise:
 *
 *   type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
 */
export async function recordAudit(tx: Tx, input: RecordAuditInput): Promise<void> {
  await tx.insert(auditLog).values({
    schoolId: input.schoolId,
    actorMembershipId: input.actorMembershipId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? {},
  });
}
