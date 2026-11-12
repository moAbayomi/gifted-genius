// tests/integration/roles/kind.test.ts
import { describe, it, expect } from "vitest";
import { sql} from "drizzle-orm";
import { db } from "../../../src/db/client.js";
import { createSchoolWithDefaults } from "../../../src/modules/schools/service.js";
import { DEFAULT_ROLES } from "../../../src/modules/rbac/default-roles.js";
import { users } from "../../../src/db/schema/index.js";
import { one } from "../../../src/shared/utils/assert.js";

describe("roles.kind", () => {
  it("encodes the owner-is-staff policy (ADR 002)", () => {
    const owner = DEFAULT_ROLES.find((r) => r.key === "owner");
    expect(owner).toBeDefined();
    expect(owner!.kind).toBe("staff");

    // If this fails, someone added `admin` back as a kind. See
    // docs/decisions/002-roles-kind.md — there is deliberately no
    // `admin` kind; an admin is a staff member with broad permissions
    // and high rank. Authorization flows through can(), never kind.
  });

  it("createSchoolWithDefaults wires kind through to the inserted rows", async () => {
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);

    const owner = one(
      await db
        .insert(users)
        .values({
          email: `kind-test-${crypto.randomUUID()}@x.test`,
          firstName: "Kind",
          lastName: "Test",
        })
        .returning(),
    );

    const result = await createSchoolWithDefaults(
      {
        name: "Kind Test School",
        slug: `kind-test-${crypto.randomUUID()}`,
        ownerUserId: owner.id,
      },
      { via: "test" },
    );

    const byKey = Object.fromEntries(result.roles.map((r) => [r.key, r]));

    expect(byKey.owner!.kind).toBe("staff");
    expect(byKey.principal!.kind).toBe("staff");
    expect(byKey.teacher!.kind).toBe("staff");
    expect(byKey.guardian!.kind).toBe("guardian");
    expect(byKey.student!.kind).toBe("student");

    // If any of these fail with 'staff' instead of the expected kind,
    // createSchoolWithDefaults isn't passing `kind: r.kind` in the insert.
    // That's the "forgot to wire it" bug.
  });
});