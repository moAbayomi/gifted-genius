// modules/rbac/get-permissions.ts
import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import {
  membershipRoles,
  rolePermissions,
} from "../../db/schema/index.js";
import type { Permission } from "./permissions.js";

export async function getPermissionsForMembership(
  executor: DbExecutor,
  membershipId: string,
): Promise<Set<Permission>> {
  const rows = await executor
    .selectDistinct({ permission: rolePermissions.permission })
    .from(membershipRoles)
    .innerJoin(
      rolePermissions,
      eq(rolePermissions.roleId, membershipRoles.roleId),
    )
    .where(eq(membershipRoles.membershipId, membershipId));

  return new Set(rows.map((r) => r.permission as Permission));
}