import {
  pgTable,
  uuid,
  text,
  date,
  foreignKey,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { memberships } from "./memberships.js";

export const studentProfiles = pgTable(
  "student_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id").notNull(),
    schoolId: uuid("school_id").notNull(),

    admissionNumber: text("admission_number").notNull(),

    house: text("house"),

    admissionDate: date("admission_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One student profile per membership per school.
    unique("student_profiles_school_membership_uq").on(t.schoolId, t.membershipId),

    // Published FK target for enrolments and future child tables.
    unique("student_profiles_id_school_uq").on(t.id, t.schoolId),

    // Admission number unique within a school.
    unique("student_profiles_school_admission_uq").on(t.schoolId, t.admissionNumber),

    // Same-school guarantee: the membership must belong to this school.
    foreignKey({
      name: "student_profiles_membership_school_fk",
      columns: [t.membershipId, t.schoolId],
      foreignColumns: [memberships.id, memberships.schoolId],
    }).onDelete("restrict"),

    // Sanity: admission number not empty.
    check(
      "student_profiles_admission_number_chk",
      sql`length(trim(${t.admissionNumber})) > 0`,
    ),
  ],
);

export type StudentProfile = typeof studentProfiles.$inferSelect;
export type NewStudentProfile = typeof studentProfiles.$inferInsert;