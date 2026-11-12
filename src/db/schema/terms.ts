import {
  pgTable,
  uuid,
  check,
  text,
  timestamp,
  smallint,
  date,
  unique,
  foreignKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { academicSessions } from "./academic-sessions.js";

export const terms = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    sessionId: uuid("session_id").notNull(),

    // 1, 2, 3 — the ordering and uniqueness key. Free text would sort wrong.
    number: smallint("number").notNull(),

    // Display label: 'First Term', 'First Semester', 'Term One'.
    name: text("name").notNull(),

    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),

    // planned → active → closed.
    // 'closed' is NOT immutable. Late score corrections go through
    // result versions (Phase 4), not through reopening this row. The calendar
    // only records the school's term boundaries.
    status: text("status", { enum: ["planned", "active", "closed"] })
      .notNull()
      .default("planned"),

    // Whether ordinary teachers may currently enter/edit scores for this term.
    // A SEPARATE axis from status — a term can be:
    //   closed + open   (Term 1 corrections while Term 2 runs)
    //   active + closed (results under moderation)
    //
    // Reserved for the results phase: the column exists, but no API reads or
    // writes it yet. When those endpoints land, opening data entry on a
    // closed term will require calendar:manage and a reason (audited).
    // Until then it stays at its default `closed` and is not an active lock.
    // See ADR 0010 §3.
    //
    // Adding this now (while the table is empty) is free. Deferring it to
    // Phase 4 would force a heuristic backfill at that point, and would
    // invite Phase 4 to use `status` as the score-entry gate — the exact
    // "closed = immutable" trap the operational review rejected.
    dataEntryState: text("data_entry_state", { enum: ["open", "closed"] })
      .notNull()
      .default("closed"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("terms_session_number_uq").on(t.sessionId, t.number),

    // Composite FK targets for children:
    //   enrolments, results, etc. reference (term_id, school_id)
    //   student_subjects reference (term_id, session_id)  [Phase 4]
    unique("terms_id_school_uq").on(t.id, t.schoolId),
    unique("terms_id_session_uq").on(t.id, t.sessionId),

    // a term's school must match its academic session's school
    foreignKey({
      name: "terms_session_school_fk",
      columns: [t.sessionId, t.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
    }).onDelete("restrict"),

    // Sanity checks.
    check("terms_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
    check("terms_number_chk", sql`${t.number} >= 1`),
    check(
      "terms_status_chk",
      sql`${t.status} in ('planned', 'active', 'closed')`,
    ),

    check(
      "terms_data_entry_state_chk",
      sql`${t.dataEntryState} in ('open', 'closed')`,
    ),

    // Fast lookup for "list the terms of this session." The unique
    // (session_id, number) index already covers this, so this is just the
    // status filter helper.
    index("terms_school_status_idx").on(t.schoolId, t.status),

    uniqueIndex("terms_one_active_per_school")
      .on(t.schoolId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type Term = typeof terms.$inferSelect;
export type NewTerm = typeof terms.$inferInsert;
