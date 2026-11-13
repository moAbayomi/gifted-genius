import {
  pgTable,
  uuid,
  timestamp,
  foreignKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classSubjects } from "./class-subjects.js";
import { classes } from "./classes.js";
import { memberships } from "./memberships.js";

export const subjectTeacherAssignments = pgTable(
  "subject_teacher_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    classId: uuid("class_id").notNull(),
    classSubjectId: uuid("class_subject_id").notNull(),
    teacherMembershipId: uuid("teacher_membership_id").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }), // null = active
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One active assignment per (offering, teacher). Ended rows are excluded
    // so historical rows may repeat, and re-assigning after ending an old
    // row is allowed.
    uniqueIndex("subject_teacher_assignments_active_uq")
      .on(t.classSubjectId, t.teacherMembershipId)
      .where(sql`${t.endedAt} IS NULL`),

    // Class_subject and class must be a real pair on class_subjects.
    foreignKey({
      name: "subject_teacher_assignments_class_subject_class_fk",
      columns: [t.classSubjectId, t.classId],
      foreignColumns: [classSubjects.id, classSubjects.classId],
    }).onDelete("restrict"),

    // Class and school must be a real pair on classes.
    foreignKey({
      name: "subject_teacher_assignments_class_school_fk",
      columns: [t.classId, t.schoolId],
      foreignColumns: [classes.id, classes.schoolId],
    }).onDelete("restrict"),

    // Teacher membership must be a real member of this school.
    foreignKey({
      name: "subject_teacher_assignments_teacher_membership_school_fk",
      columns: [t.teacherMembershipId, t.schoolId],
      foreignColumns: [memberships.id, memberships.schoolId],
    }).onDelete("restrict"),

    // ── Child-side indexes ──────────────────────────────────────────
    // Postgres does not auto-create these for composite FKs. Without them,
    // deleting a class_subject, class, or membership seq-scans this table
    // to verify no references.
    index("subject_teacher_assignments_teacher_school_idx").on(
      t.teacherMembershipId,
      t.schoolId,
    ),
    index("subject_teacher_assignments_class_school_idx").on(
      t.classId,
      t.schoolId,
    ),
    index("subject_teacher_assignments_class_subject_class_idx").on(
      t.classSubjectId,
      t.classId,
    ),
  ],
);

export type SubjectTeacherAssignment =
  typeof subjectTeacherAssignments.$inferSelect;
export type NewSubjectTeacherAssignment =
  typeof subjectTeacherAssignments.$inferInsert;
