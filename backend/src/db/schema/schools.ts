import {
  pgTable,
  uuid,
  text,
  uniqueIndex,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const schools = pgTable(
  "schools",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // identity
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    shortName: text("short_name"),
    type: text("type", { enum: ["junior", "senior", "combined"] })
      .notNull()
      .default("combined"),

    // public profile
    motto: text("motto"),
    address: text("address"),
    city: text("city"),
    state: text("state"),

    // schools public contact info
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),

    // account state
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),

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
    uniqueIndex("schools_slug_uq").on(t.slug),
    check("schools_slug_chk", sql`${t.slug} ~ '^[a-z0-9-]+$'`),
    check("schools_status_chk", sql`${t.status} in ('active', 'suspended')`),
    check(
      "schools_type_chk",
      sql`${t.type} in ('junior', 'senior', 'combined')`,
    ),
  ],
);

export type School = typeof schools.$inferSelect;
export type NewSchool = typeof schools.$inferInsert;
