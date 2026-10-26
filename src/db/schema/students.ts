import {
  pgTable,
  uuid,
  text,
  date,
  foreignKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { memberships } from "./memberships.js";

export const students = pgTable(
  "students",
  {
    // 1:1 with memberships. The PK *is* the membership — a student profile
    // has no identity of its own; it extends the membership row.
    membershipId: uuid("membership_id").primaryKey(),

    // Carried for the composite FK. Guarantees this student's membership
    // belongs to the same school as this row.
    schoolId: uuid("school_id").notNull(),

    // ── School-issued identifier ──
    admissionNumber: text("admission_number").notNull(),

    // ── Personal / demographic (student-specific) ──
    house: text("house"),

    // ── Lifecycle ──
    admissionDate: date("admission_date"),
  },
  (t) => [
    // Same-school guarantee: (membershipId, schoolId) must exist as a
    // real (id, schoolId) pair in memberships.
    foreignKey({
      name: "students_membership_school_fk",
      columns: [t.membershipId, t.schoolId],
      foreignColumns: [memberships.id, memberships.schoolId],
    }),

    // Admission number is unique *within a school*. Two schools can both
    // have "STU/2024/001".
    uniqueIndex("students_school_admission_uq").on(
      t.schoolId,
      t.admissionNumber,
    ),
  ],
);

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
