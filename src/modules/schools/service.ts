// db/repositories/schools.ts
import db from "../../db/client.js";
import {
  schools,
  roles,
  rolePermissions,
  memberships,
  membershipRoles,
} from "../../db/schema/index.js";
import { DEFAULT_ROLES } from "../rbac/default-roles.js";
import { recordAudit } from "../../shared/audit/record.js";
import { one, mustGet } from "../../shared/utils/assert.js";
import type { Tx } from "../../db/types.js";
import { redactSchool } from "../../shared/audit/redact.js";


export interface CreateSchoolInput {
  name: string;
  slug: string;
  ownerUserId: string;
}

export async function createSchoolWithDefaults(
  input: CreateSchoolInput,
  opts?: { tx?: Tx; via?: string },
) {
  const run = async (tx: Tx) => {
    // 1. School — `one()` unwraps the array, throws if somehow empty
    const school = one(
      await tx
        .insert(schools)
        .values({ name: input.name, slug: input.slug })
        .returning(),
    );

    // 2. Roles — `createdRoles` is Role[] (fine, that's the whole array)
    const createdRoles = await tx
      .insert(roles)
      .values(
        DEFAULT_ROLES.map((r) => ({
          schoolId: school.id,
          key: r.key,
          name: r.name,
          description: r.description,
          rank: r.rank,
          isSystem: true,
        })),
      )
      .returning();

    // 3. Index by key. The `as` assertion is safe: we just built this map,
    //    it has exactly the keys we inserted.
    const roleByKey = Object.fromEntries(
      createdRoles.map((r) => [r.key, r]),
    ) as Record<string, (typeof createdRoles)[number]>;

    // 4. Permissions — `mustGet` throws if a default role's key is missing
    //    from the insert result (which would mean a very surprising bug).
    const permissionRows = DEFAULT_ROLES.flatMap((def) => {
      const role = mustGet(roleByKey, def.key, "role insert result");
      return def.permissions.map((p) => ({
        roleId: role.id,
        permission: p,
      }));
    });

    if (permissionRows.length > 0) {
      await tx.insert(rolePermissions).values(permissionRows);
    }

    // 5. Owner membership
    const ownerMembership = one(
      await tx
        .insert(memberships)
        .values({
          userId: input.ownerUserId,
          schoolId: school.id,
          status: "active",
        })
        .returning(),
    );

    // 6. Owner role assignment
    const ownerRole = mustGet(roleByKey, "owner", "owner role lookup");

    await tx.insert(membershipRoles).values({
      membershipId: ownerMembership.id,
      roleId: ownerRole.id,
      schoolId: school.id,
      assignedBy: null,
    });

    // 7. Audit
    await recordAudit(tx, {
      schoolId: school.id,
      actorMembershipId: null,
      action: "school.created",
      targetType: "school",
      targetId: school.id,
      after: redactSchool(school),
      metadata: {
        via: opts?.via ?? "createSchoolWithDefaults",
        ownerUserId: input.ownerUserId,
      },
    });

    return { school, roles: createdRoles, ownerMembership };
  };

  if (opts?.tx) return run(opts.tx);
  return db.transaction(run); 
}
