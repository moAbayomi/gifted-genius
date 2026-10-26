// db/schema/role_permissions.ts
import {
  pgTable,
  uuid,
  text,
  primaryKey,
} from "drizzle-orm/pg-core";
import { roles } from "./roles.js";

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, {onDelete: "cascade"}),
    permission: text("permission").notNull(),   // 'users:create', 'results:enter', ...
  },
  (t) => [
    // A role can hold a given permission at most once.
    // (roleId, permission) is the identity — no surrogate id needed.
    primaryKey({ columns: [t.roleId, t.permission] }),
  ],
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;