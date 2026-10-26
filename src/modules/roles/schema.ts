// modules/roles/schema.ts
import { z } from "zod";
import { PERMISSIONS } from "../rbac/permissions.js";

/**
 * Update a role's permission set.
 * PUT /roles/:id/permissions
 * Body: { permissions: ["users:create", "users:read", ...] }
 *
 * The schema validates SHAPE only. The two invariants are enforced in the
 * service, because they depend on runtime data (which role is being edited,
 * who is editing):
 *
 *   1. The owner role's permissions cannot be changed (needs to know which
 *      role the id points to — that's a service concern).
 *   2. Every permission in the new set must be held by the editor
 *      (subset rule — needs actor.permissions at check time).
 *
 * Schema-level checks: each string looks like resource:action, no
 * duplicates, not empty.
 */

// ── Assign a role to a member ─────────────────────────────────────
export const assignRoleSchema = z
  .object({
    roleKey: z.string().trim().min(1).max(50),
  })
  .strict();

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

// ── Update a role's permission set ────────────────────────────────
export const updateRolePermissionsSchema = z
  .object({
    permissions: z
      .array(z.enum(PERMISSIONS))
      .min(1)
      .refine((perms) => new Set(perms).size === perms.length, {
        message: "permissions must not contain duplicates",
      }),
  })
  .strict();

export type UpdateRolePermissionsInput = z.infer<
  typeof updateRolePermissionsSchema
>;
