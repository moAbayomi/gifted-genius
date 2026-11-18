import {
  pgTable,
  uuid,
  text,
  smallint,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./schools.js";

export const levels = pgTable(
  "levels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    sequence: smallint("sequence").notNull(),
    stage: text("stage", { enum: ["junior", "senior"] }).notNull(),

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
    // No two levels with the same display name in a school.
    unique("levels_school_name_uq").on(t.schoolId, t.name),

    // No two levels with the same sequence in a school.
    // This unique constraint's backing index also serves
    // "list levels of a school ordered by sequence" — no extra index needed.
    unique("levels_school_sequence_uq").on(t.schoolId, t.sequence),

    // FK target for classes:
    //   classes (level_id, school_id) → levels (id, school_id)
    // MUST be `unique()` (a CONSTRAINT), not `uniqueIndex()`, so it is
    // emitted inline in CREATE TABLE — before the FK that references it.
    unique("levels_id_school_uq").on(t.id, t.schoolId),

    check("levels_sequence_chk", sql`${t.sequence} >= 1`),
    check("levels_stage_chk", sql`${t.stage} in ('junior', 'senior')`),
  ],
);

export type Level = typeof levels.$inferSelect;
export type NewLevel = typeof levels.$inferInsert;
