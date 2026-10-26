import { eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/types.js";
import { membershipRoles, roles } from "../../db/schema/index.js";

/**
 * Return the role keys a membership holds: ["owner"], ["teacher"], etc.
 * Used by /me to tell the frontend what labels to show.
 */
export async function getRolesForMembership(
  executor: DbExecutor,
  membershipId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ key: roles.key })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(eq(membershipRoles.membershipId, membershipId));
  return rows.map((r) => r.key);
}