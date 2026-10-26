import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
  foreignKey,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { memberships } from "./memberships.js";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),

    // Always present — identifies the authenticated user.
    userId: uuid("user_id").notNull(),

    // The school context this session is currently acting under.
    activeMembershipId: uuid("active_membership_id").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expires_at_idx").on(t.expiresAt),

    // userId must reference a real user.
    foreignKey({
      name: "sessions_user_fk",
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete("cascade"),

    // THE FIX: if there IS an active membership, it must belong to THIS user.
    // Composite FK — Postgres skips the check when activeMembershipId is NULL,
    // so "no membership yet" is allowed, but "wrong user's membership" is not.
    foreignKey({
      name: "sessions_membership_user_fk",
      columns: [t.activeMembershipId, t.userId],
      foreignColumns: [memberships.id, memberships.userId],
    }).onDelete("restrict"),
  ],
);
