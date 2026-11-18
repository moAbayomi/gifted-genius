import {
  pgTable,
  uuid,
  check,
  text,
  timestamp,
  uniqueIndex,
  unique,
} from "drizzle-orm/pg-core";
import { schools } from "./schools.js";
import { sql } from "drizzle-orm";

export const academicSessions = pgTable(
  "academic_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, {
        onDelete: "restrict",
      }),
    label: text("label").notNull(),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One label per school. '2026/2027' can exist once per school.
    uniqueIndex("academic_sessions_school_label_uq").on(t.schoolId, t.label),

    // Enables the composite FK from terms:
    //   terms(session_id, school_id) -> academic_sessions(id, school_id)
    // Same pattern as memberships' (id, school_id) unique index.
    unique("academic_sessions_id_school_uq").on(t.id, t.schoolId),
    // Format: 'YYYY/YYYY'. Rejects '2026/27' on purpose — the PRD uses the
    // 4-digit format. If you later want to accept 2-digit ends, loosen to
    // '^[0-9]{4}/[0-9]{2,4}$'.
    check(
      "academic_sessions_label_chk",
      sql`${t.label} ~ '^[0-9]{4}/[0-9]{4}$'`,
    ),
  ],
);

export type AcademicSession = typeof academicSessions.$inferSelect;
export type NewAcademicSession = typeof academicSessions.$inferInsert;
