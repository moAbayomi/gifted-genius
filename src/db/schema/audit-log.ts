import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./schools.js";
import { memberships } from "./memberships.js";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Nullable for platform-level actions (no school context).
    // The composite FK below handles system-actor cases via MATCH SIMPLE.
    schoolId: uuid("school_id").references(() => schools.id, {
      onDelete: "restrict",
    }),

    // Null = system action (seed, script, migration).
    actorMembershipId: uuid("actor_membership_id"),

    action: text("action").notNull(), // 'user.created', 'role.assigned'
    targetType: text("target_type").notNull(), // 'membership', 'role', 'student'
    targetId: uuid("target_id"), // no FK on purpose: polymorphic

    // Full state snapshots. Null for actions that don't mutate a row.
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),

    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Actor must have acted within the same school as the action.
    // Skipped (via MATCH SIMPLE) when either column is NULL — system/platform actions.
    foreignKey({
      name: "audit_actor_school_fk",
      columns: [t.actorMembershipId, t.schoolId],
      foreignColumns: [memberships.id, memberships.schoolId],
    }),

    check(
      "audit_actor_needs_school_chk",
      sql`${t.actorMembershipId} is null or ${t.schoolId} is not null`,
    ),

    // Admin activity feed: "what happened at this school recently?"
    index("audit_school_time_idx").on(t.schoolId, t.createdAt.desc()),

    // Entity history: "what happened to this student / role / result?"
    index("audit_target_time_idx").on(
      t.targetType,
      t.targetId,
      t.createdAt.desc(),
    ),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;
