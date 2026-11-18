import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { academicSessions } from "./academic-sessions.js";
import { levels } from "./levels.js";
import { memberships } from "./memberships.js";

export const classes = pgTable(
  "classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schoolId: uuid("school_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    levelId: uuid("level_id").notNull(),
    formTeacherMembershipId: uuid("form_teacher_membership_id"),
    armLabel: text("arm_label").notNull(),
    track: text("track", {
      enum: ["general", "science", "arts", "commercial"],
    })
      .notNull()
      .default("general"),

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
    unique("classes_session_level_arm_track_uq").on(
      t.sessionId,
      t.levelId,
      t.armLabel,
      t.track,
    ),
    unique("classes_id_session_uq").on(t.id, t.sessionId),
    unique("classes_id_school_uq").on(t.id, t.schoolId),

    check("classes_arm_label_chk", sql`length(trim(${t.armLabel})) > 0`),
    check(
      "classes_track_chk",
      sql`${t.track} in ('general', 'science', 'arts', 'commercial')`,
    ),

    foreignKey({
      name: "classes_session_school_fk",
      columns: [t.sessionId, t.schoolId],
      foreignColumns: [academicSessions.id, academicSessions.schoolId],
    }).onDelete("restrict"),

    foreignKey({
      name: "classes_level_school_fk",
      columns: [t.levelId, t.schoolId],
      foreignColumns: [levels.id, levels.schoolId],
    }).onDelete("restrict"),

    foreignKey({
      name: "classes_form_teacher_membership_school_fk",
      columns: [t.formTeacherMembershipId, t.schoolId],
      foreignColumns: [memberships.id, memberships.schoolId],
    }),
  ],
);

export type Class = typeof classes.$inferSelect;
export type NewClass = typeof classes.$inferInsert;
