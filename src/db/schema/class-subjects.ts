// src/db/schema/class-subjects.ts
import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  foreignKey,
  unique,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classes } from "./classes.js";
import { subjects } from "./subjects.js";
import { electiveGroups } from "./elective-groups.js";

export const classSubjects = pgTable(
  "class_subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    classId: uuid("class_id").notNull(),
    subjectId: uuid("subject_id").notNull(),
    electiveGroupId: uuid("elective_group_id"), // nullable — core subjects have none
    isCompulsory: boolean("is_compulsory").notNull().default(false),

    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // A class offers each subject at most once.
    unique("class_subjects_class_subject_uq").on(t.classId, t.subjectId),

    // A compulsory offering cannot also belong to an elective group.
    check(
      "class_subjects_compulsory_not_elective_chk",
      sql`NOT (${t.isCompulsory} AND ${t.electiveGroupId} IS NOT NULL)`,
    ),

    // Published FK target for student_subjects (normal path).
    unique("class_subjects_id_class_uq").on(t.id, t.classId),

    // Class and school must be a real (class, school) pair on classes.
    foreignKey({
      name: "class_subjects_class_school_fk",
      columns: [t.classId, t.schoolId],
      foreignColumns: [classes.id, classes.schoolId],
    }).onDelete("restrict"),

    // Subject and school must be a real (subject, school) pair on subjects.
    foreignKey({
      name: "class_subjects_subject_school_fk",
      columns: [t.subjectId, t.schoolId],
      foreignColumns: [subjects.id, subjects.schoolId],
    }).onDelete("restrict"),

    // Elective group must belong to the same class.
    // MATCH SIMPLE: fires only when elective_group_id IS NOT NULL.
    // Core subjects leave it NULL and skip this FK.
    foreignKey({
      name: "class_subjects_elective_group_class_fk",
      columns: [t.electiveGroupId, t.classId],
      foreignColumns: [electiveGroups.id, electiveGroups.classId],
    }).onDelete("restrict"),

    // FK-check indexes — Postgres does not auto-create these on the child.
    // Without them, deleting a subject or elective group seq-scans this table
    // to verify no class_subjects rows reference it.
    index("class_subjects_subject_school_idx").on(t.subjectId, t.schoolId),
    index("class_subjects_elective_group_class_idx").on(
      t.electiveGroupId,
      t.classId,
    ),
  ],
);

export type ClassSubject = typeof classSubjects.$inferSelect;
export type NewClassSubject = typeof classSubjects.$inferInsert;
