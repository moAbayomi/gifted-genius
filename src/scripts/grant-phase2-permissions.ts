// scripts/grant-phase2-permissions.ts
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { schools, roles, rolePermissions } from "../db/schema/index.js";
import { DEFAULT_ROLES } from "../modules/rbac/default-roles.js";

async function main() {
  const allSchools = await db.select().from(schools);
  console.log(`Found ${allSchools.length} school(s)`);

  // Build the lookup once. `key` → the permission list for that key.
  const defaultsByKey = Object.fromEntries(
    DEFAULT_ROLES.map((r) => [r.key, r.permissions]),
  ) as Record<string, readonly string[]>;

  let granted = 0;

  for (const school of allSchools) {
    const schoolRoles = await db
      .select()
      .from(roles)
      .where(eq(roles.schoolId, school.id));

    for (const role of schoolRoles) {
      // Custom roles aren't in DEFAULT_ROLES → empty array → skipped.
      const shouldHave = defaultsByKey[role.key] ?? [];
      if (shouldHave.length === 0) continue;

      const inserted = await db
        .insert(rolePermissions)
        .values(shouldHave.map((permission) => ({ roleId: role.id, permission })))
        .onConflictDoNothing()
        .returning({ permission: rolePermissions.permission });

      if (inserted.length > 0) {
        console.log(
          `  ${school.slug} / ${role.key}: +${inserted.length} permission(s)`,
        );
        granted += inserted.length;
      }
    }
  }

  console.log(`\nGranted ${granted} new permission row(s) across all schools.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Grant script failed:", err);
    process.exit(1);
  });