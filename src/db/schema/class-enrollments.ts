// src/db/schema/class-enrollments.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  foreignKey,
  unique,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classes } from "./classes.js";
import { studentProfiles } from "./student-profiles.js";

export const classEnrollments = pgTable(
  "class_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    studentId: uuid("student_id").notNull(),
    classId: uuid("class_id").notNull(),
    sessionId: uuid("session_id").notNull(), // copied from class; never caller-chosen

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["active", "transferred", "withdrawn"] })
      .notNull()
      .default("active"),
    endedAt: timestamp("ended_at", { withTimezone: true }), // null = active
    endedReason: text("ended_reason"),

    transferredFromEnrollmentId: uuid("transferred_from_enrollment_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Published FK target for student_subjects (normal path):
    //   student_subjects (enrollment_id, class_id) → class_enrollments (id, class_id)
    unique("class_enrollments_id_class_uq").on(t.id, t.classId),
    // Same-school FK target for the transfer source.
    unique("class_enrollments_id_school_uq").on(t.id, t.schoolId),

    // At most one live enrollment per (student, session).
    // Ended enrollments are excluded from the index, so a student may have
    // several historical enrollments per session (transfers within a session)
    // as long as only one is live at a time. This is the mechanism that
    // supports "transfer as ended row + new row" (ADR 0018).
    uniqueIndex("class_enrollments_one_active_session_uq")
      .on(t.studentId, t.sessionId)
      .where(sql`${t.endedAt} IS NULL`),

    // Class and session must be a real (class, session) pair on classes.
    foreignKey({
      name: "class_enrollments_class_session_fk",
      columns: [t.classId, t.sessionId],
      foreignColumns: [classes.id, classes.sessionId],
    }).onDelete("restrict"),

    // Class and school must be a real (class, school) pair on classes.
    // Redundant with the class/session FK in isolation, but together the
    // two FKs pin (class, session, school) to the same parent row.
    foreignKey({
      name: "class_enrollments_class_school_fk",
      columns: [t.classId, t.schoolId],
      foreignColumns: [classes.id, classes.schoolId],
    }).onDelete("restrict"),

    // Student and school must be a real (student, school) pair on student_profiles.
    foreignKey({
      name: "class_enrollments_student_school_fk",
      columns: [t.studentId, t.schoolId],
      foreignColumns: [studentProfiles.id, studentProfiles.schoolId],
    }).onDelete("restrict"),

    // Transfer source, if any, must be a real enrollment in the same school.
    foreignKey({
      name: "class_enrollments_transferred_from_fk",
      columns: [t.transferredFromEnrollmentId, t.schoolId],
      foreignColumns: [t.id, t.schoolId],
    }).onDelete("restrict"),

    // Sanity checks.
    check(
      "class_enrollments_status_ended_chk",
      sql`${t.status} IN ('active', 'transferred', 'withdrawn')
              AND (
                (${t.status} = 'active' AND ${t.endedAt} IS NULL)
                OR
                (${t.status} <> 'active' AND ${t.endedAt} IS NOT NULL)
              )`,
    ),
    check(
      "class_enrollments_dates_chk",
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`,
    ),
    check(
      "class_enrollments_ended_reason_requires_end_chk",
      sql`${t.endedReason} IS NULL OR ${t.endedAt} IS NOT NULL`,
    ),
    check(
      "class_enrollments_ended_reason_nonempty_chk",
      sql`${t.endedReason} IS NULL OR length(trim(${t.endedReason})) > 0`,
    ),

    // FK-check indexes on the child side.
    // Postgres does NOT auto-create these for composite FKs, so without them
    // a parent delete seq-scans class_enrollments.
    index("class_enrollments_class_session_idx").on(t.classId, t.sessionId),
    index("class_enrollments_student_school_idx").on(t.studentId, t.schoolId),
    index("class_enrollments_transferred_from_idx").on(
      t.transferredFromEnrollmentId,
      t.schoolId,
    ),
  ],
);

export type ClassEnrollment = typeof classEnrollments.$inferSelect;
export type NewClassEnrollment = typeof classEnrollments.$inferInsert;
