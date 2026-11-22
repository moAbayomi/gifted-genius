import {
  pgTable,
  uuid,
  integer,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { schools } from "./schools.js";

/**
 * Per-school, per-admission-year sequence used only when the CSV does not
 * supply an admission number. Locked with FOR UPDATE before allocation.
 */
export const admissionCounters = pgTable(
  "admission_counters",
  {
    schoolId: uuid("school_id").notNull(),
    year: integer("year").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.schoolId, t.year] }),
    foreignKey({
      name: "admission_counters_school_fk",
      columns: [t.schoolId],
      foreignColumns: [schools.id],
    }).onDelete("cascade"),
  ],
);

export type AdmissionCounter = typeof admissionCounters.$inferSelect;
