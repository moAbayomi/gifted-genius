import {
  pgTable,
  uuid,
  timestamp,
  primaryKey,
  foreignKey,
  index,
} from "drizzle-orm/pg-core";
import { memberships } from "./memberships.js";
import { roles } from "./roles.js";

export const membershipRoles = pgTable(
  "membership_roles",
  {
    membershipId: uuid("membership_id").notNull(),
    roleId: uuid("role_id").notNull(),

    // Carried for the composite FK to memberships — enforces "same school".
    schoolId: uuid("school_id").notNull(),

    // Who assigned this role. Nullable — audit trail, not required.
    assignedBy: uuid("assigned_by"),

    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // A role is assigned to a membership at most once.
    // (membershipId, roleId) is the natural key — no surrogate `id` needed.
    primaryKey({ columns: [t.membershipId, t.roleId] }),

    // The big one: this role assignment's membership must live at this school.
    // Composite FK → memberships(id, schoolId) — the multi-tenancy guarantee.
    foreignKey({
      name: "membership_roles_membership_school_fk",
      columns: [t.membershipId, t.schoolId],
      foreignColumns: [memberships.id, memberships.schoolId],
    }),

    foreignKey({
      name: "membership_roles_role_school_fk",
      columns: [t.roleId, t.schoolId],
      foreignColumns: [roles.id, roles.schoolId],
    }),

    // Who assigned the role. Optional — see note below.
    foreignKey({
      name: "membership_roles_assigned_by_school_fk",
      columns: [t.assignedBy, t.schoolId],
      foreignColumns: [memberships.id, memberships.schoolId],
    }),

    // "List all teachers at this school" / "all principals at this school".
    // The PK covers (membershipId, roleId); this covers (schoolId, roleId).
    index("membership_roles_school_role_idx").on(t.schoolId, t.roleId),
  ],
);

export type MembershipRole = typeof membershipRoles.$inferSelect;
export type NewMembershipRole = typeof membershipRoles.$inferInsert;
