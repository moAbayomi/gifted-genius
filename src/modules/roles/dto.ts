// modules/roles/dto.ts
import type { Role } from "../../db/schema/index.js";

/**
 * A role at ONE school. Roles are per-tenant — the "teacher" role at
 * School A is a different row from "teacher" at School B.
 *
 * `rank` is exposed so the client can filter the role picker:
 * an actor can only assign roles whose rank is strictly below their own.
 * The server enforces this; the client uses it to hide unassignable roles.
 *
 * `isSystem` is exposed so the UI can mark system roles as non-deletable.
 * The server enforces immutability for the owner role separately.
 */
export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  rank: number;
  isSystem: boolean;
}

export function toRoleDto(role: Role): RoleDto {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    rank: role.rank,
    isSystem: role.isSystem,
  };
}

/**
 * Role detail with permissions. Used by GET /roles/:id (single role view)
 * and as the response for PUT /roles/:id/permissions.
 *
 * Not used in GET /roles (list) — the list doesn't need the full permission
 * array for every role. That would be 100+ permission strings per role × 5
 * roles = bloated responses. Load permissions only when the admin opens a
 * role detail view.
 */
export interface RoleDetailDto extends RoleDto {
  permissions: string[];
}

export function toRoleDetailDto(
  role: Role,
  permissions: string[],
): RoleDetailDto {
  return {
    ...toRoleDto(role),
    permissions,
  };
}
