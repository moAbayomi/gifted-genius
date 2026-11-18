import {
  pgTable,
  uuid,
  timestamp,
  text,
  smallint,
  check,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { classes } from "./classes.js";

export const electiveGroups = pgTable(
  "elective_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    classId: uuid("class_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    name: text("name").notNull(),
    minChoices: smallint("min_choices").notNull(),
    maxChoices: smallint("max_choices").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("elective_groups_min_choices_chk", sql`${t.minChoices} >= 0`),
    check(
      "elective_groups_max_choices_chk",
      sql`${t.maxChoices} >= ${t.minChoices}`,
    ),
    unique("elective_groups_class_name_uq").on(t.classId, t.name),
    unique("elective_groups_id_class_uq").on(t.id, t.classId),

    // Class and school must be a real (class, school) pair on classes.
    foreignKey({
      name: "elective_groups_class_school_fk",
      columns: [t.classId, t.schoolId],
      foreignColumns: [classes.id, classes.schoolId],
    }).onDelete("restrict"),

    // Class and session must be a real (class, session) pair on classes.
    foreignKey({
      name: "elective_groups_class_session_fk",
      columns: [t.classId, t.sessionId],
      foreignColumns: [classes.id, classes.sessionId],
    }).onDelete("restrict"),
  ],
);

export type ElectiveGroup = typeof electiveGroups.$inferSelect;
export type NewElectiveGroup = typeof electiveGroups.$inferInsert;
