// The starting definition of every SYSTEM role at a school. Read by
// createSchoolWithDefaults to seed `roles`, `role_permissions`, and the
// owner's role assignment in one transaction.
//
// A school admin can change role permissions per school later — that's
// what per-school roles are for. This file defines the STARTING POINT,
// not policy. Changing a value here affects schools created *after* the
// deploy, not existing ones.

import { PERMISSIONS, type Permission } from "./permissions.js";

export interface DefaultRole {
  readonly key: string;
  readonly name: string;
  /** Higher rank = more authority. Guards compare strictly (actor must have higher rank than target). */
  readonly description: string;
  readonly rank: number;
  readonly permissions: readonly Permission[];
}

export const DEFAULT_ROLES = [
  {
    key: "owner",
    name: "Owner",
    description: "Proprietor. Full access to all features and settings.",
    rank: 100,
    permissions: [...PERMISSIONS],
  },
  {
    key: "principal",
    name: "Principal",
    description:
      "Runs the school day-to-day. Manages staff, students, and operations.",
    rank: 80,
    permissions: [
      "school:read",
      "users:read",
      "users:create",
      "users:update",
      "users:suspend",
      "users:reset_password",
      "roles:read",
      "roles:assign",
      "audit:read",
    ],
  },
  {
    key: "teacher",
    name: "Teacher",
    description:
      "Teaches classes and records student progress for their subjects.",
    rank: 50,
    permissions: ["school:read"],
  },
  {
    key: "guardian",
    name: "Parent/Guardian",
    description:
      "Parent or guardian of enrolled students. Views their ward's records.",
    rank: 25,
    permissions: ["school:read"],
  },
  {
    key: "student",
    name: "Student",
    description: "Enrolled student. Views their own records and profile.",
    rank: 20,
    permissions: ["school:read"],
  },
] as const satisfies readonly DefaultRole[];

export type RoleKey = (typeof DEFAULT_ROLES)[number]["key"];
