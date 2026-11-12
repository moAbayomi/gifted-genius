import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  smallint,
  check,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schools } from "./schools.js";

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "restrict" }),
    rank: smallint("rank").notNull(),

    // The stable identifier *within this school*. 'teacher', 'principal', etc.
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),

    // Categorical: who a member with this role IS.
    //   staff    — can be assigned as a teacher, holds employment data
    //   student  — can be enrolled in a class
    //   guardian — can be linked to a student via guardian_students
    // Never consulted for authorization — that's `can()` and rank.
    // See docs/decisions/002-roles-kind.md.
    kind: text("kind", { enum: ["staff", "student", "guardian"] })
      .notNull()
      .default("staff"),

    isSystem: boolean("is_system").notNull().default(false),

    // audit
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("roles_rank_chk", sql`${t.rank} between 1 and 100`),
    // "Within this school, a role key is unique." School A can have 'teacher',
    // School B can also have 'teacher' — but School A can't have two 'teacher's.
    uniqueIndex("roles_school_key_uq").on(t.schoolId, t.key),

    check("roles_kind_chk", sql`${t.kind} in ('staff', 'student', 'guardian')`),

    // Enables the composite FK from membership_roles:
    //   (roleId, schoolId) → roles(id, schoolId)
    // Same pattern as memberships' (id, schoolId) unique index.
    unique("roles_id_school_uq").on(t.id, t.schoolId),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
