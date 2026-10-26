import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // login details (nullable)
    email: text("email"),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    // who user is (always required)
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    middleName: text("middle_name"),

    // contact & personal
    phone: text("phone"),
    

    // account state
    status: text("status", { enum: ["active", "suspended"] })
      .notNull()
      .default("active"),

    // genesis
    mustChangePassword: boolean("must_change_password").notNull().default(true),

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
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    index("users_phone_idx").on(t.phone),
    check("users_status_chk", sql`${t.status} in ('active', 'suspended')`),
  ],
);


export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert