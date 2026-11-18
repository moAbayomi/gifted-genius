import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { schools } from "./schools.js";
import { sql } from "drizzle-orm";

export const subjects = pgTable(
  "subjects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
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
    foreignKey({
      name: "subjects_school_fk",
      columns: [t.schoolId],
      foreignColumns: [schools.id],
    }).onDelete("restrict"),

    unique("subjects_school_code_uq").on(t.schoolId, t.code),
    unique("subjects_id_school_uq").on(t.id, t.schoolId),
    check("subjects_code_chk", sql`length(trim(${t.code})) > 0`),
    check("subjects_name_chk", sql`length(trim(${t.name})) > 0`),
  ],
);

export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;
