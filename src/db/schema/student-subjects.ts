// src/db/schema/student-subjects.ts
import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  foreignKey,
  unique,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classEnrollments } from "./class-enrollments.js";
import { classSubjects } from "./class-subjects.js";
import { subjects } from "./subjects.js";
import { classes } from "./classes.js";

export const studentSubjects = pgTable(
  "student_subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    classId: uuid("class_id").notNull(),
    sessionId: uuid("session_id").notNull(), // copied from class; never caller-chosen

    // Mutually exclusive — see ADR 0015.
    //   Normal subject → class_subject_id set, subject_id null
    //   Extra subject  → class_subject_id null, subject_id set
    classSubjectId: uuid("class_subject_id"),
    subjectId: uuid("subject_id"),

    // Derived from class_subject_id IS NULL. ADR 0015 prefers a generated
    // column; either works — this is a STORED generated column.
    isExtra: boolean("is_extra")
      .notNull()
      .generatedAlwaysAs(sql`class_subject_id IS NULL`),

    droppedAt: timestamp("dropped_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One choice per offering per enrollment (normal subjects).
    // NULLs are distinct in unique indexes, so this does not constrain extras;
    // the partial unique below handles that path.
    unique("student_subjects_enrollment_offering_uq").on(
      t.enrollmentId,
      t.classSubjectId,
    ),

    // One choice per subject per enrollment (extra subjects).
    // Partial: fires only when subject_id is not null (i.e. extras).
    uniqueIndex("student_subjects_enrollment_subject_extra_uq")
      .on(t.enrollmentId, t.subjectId)
      .where(sql`${t.subjectId} IS NOT NULL`),

    // Published FK target for results (composite).
    unique("student_subjects_id_class_uq").on(t.id, t.classId),

    // ── Exactly one of class_subject_id / subject_id ──────────────
    check(
      "student_subjects_one_choice_chk",
      sql`num_nonnulls(${t.classSubjectId}, ${t.subjectId}) = 1`,
    ),

    // ── FKs ──────────────────────────────────────────────────────
    // 1. Enrollment — pins the class to the enrollment's class.
    foreignKey({
      name: "student_subjects_enrollment_class_fk",
      columns: [t.enrollmentId, t.classId],
      foreignColumns: [classEnrollments.id, classEnrollments.classId],
    }).onDelete("restrict"),

    // 2. Offering — normal path. MATCH SIMPLE skips when class_subject_id is null.
    foreignKey({
      name: "student_subjects_offering_class_fk",
      columns: [t.classSubjectId, t.classId],
      foreignColumns: [classSubjects.id, classSubjects.classId],
    }).onDelete("restrict"),

    // 3. Subject — extra path. Composite pins the school too (tenancy).
    foreignKey({
      name: "student_subjects_subject_school_fk",
      columns: [t.subjectId, t.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
    }).onDelete("restrict"),

    // 4. Class — pins the session the row claims.
    foreignKey({
      name: "student_subjects_class_session_fk",
      columns: [t.classId, t.sessionId],
      foreignColumns: [classes.id, classes.sessionId],
    }).onDelete("restrict"),

    // 5. Class — pins the school the row claims (tenancy).
    foreignKey({
      name: "student_subjects_class_school_fk",
      columns: [t.classId, t.schoolId],
      foreignColumns: [classes.id, classes.schoolId],
    }).onDelete("restrict"),

    // ── FK-child indexes (Postgres does not auto-create these) ───
    index("student_subjects_enrollment_class_idx").on(
      t.enrollmentId,
      t.classId,
    ),
    index("student_subjects_offering_class_idx").on(
      t.classSubjectId,
      t.classId,
    ),
    index("student_subjects_subject_school_idx").on(t.subjectId, t.schoolId),
    index("student_subjects_class_session_idx").on(t.classId, t.sessionId),
  ],
);

export type StudentSubject = typeof studentSubjects.$inferSelect;
export type NewStudentSubject = typeof studentSubjects.$inferInsert;
