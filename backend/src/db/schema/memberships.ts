// db/schema/memberships.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";
import { schools } from "./schools.js";

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ── Who, and at which school ──
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "restrict" }),

    // Optional: parents and owners often have none.
    username: text("username"),

    // ── Membership state
    status: text("status", { enum: ["active", "inactive", "suspended"] })
      .notNull()
      .default("active"),

    // ── Lifecycle ──
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // A person is one member per school. No duplicate memberships.
    uniqueIndex("memberships_school_user_uq").on(t.schoolId, t.userId),

    check(
      "memberships_username_chk",
      sql`${t.username} is null or ${t.username} = lower(${t.username})`,
    ),

    // Per-school username is unique *within that school*.
    // Multiple NULLs allowed by Postgres — parents without a handle are fine.
    uniqueIndex("memberships_school_username_uq").on(t.schoolId, t.username),

    // The linchpin: enables composite FKs from every child table
    // (membership_roles, students, staff, guardian_students, …) so they
    // can guarantee "same school" without extra joins.
    unique("memberships_id_school_uq").on(t.id, t.schoolId),

    // "Which schools is this user a member of?" — the school switcher.
    index("memberships_user_idx").on(t.userId),
    
    unique("memberships_id_user_uq").on(t.id, t.userId),

    // "Show all active members at this school." Admin dashboard.
    index("memberships_school_status_idx").on(t.schoolId, t.status),

    // DB-level guard on status (Drizzle's TS enum is compile-time only).
    check(
      "memberships_status_chk",
      sql`${t.status} in ('active', 'inactive', 'suspended')`,
    ),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
