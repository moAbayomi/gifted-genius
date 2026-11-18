// tests/integration/rbac/rank.test.ts
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import db from "../../src/db/client.js";
import { seed } from "../../src/db/seed.js";
import { createSchoolWithDefaults } from "../../src/modules/schools/service.js";
import {
  users,
  memberships,
  roles,
  membershipRoles,
  schools,
} from "../../src/db/schema/index.js";
import {
  loadMembershipRank,
  assertCanActOnUser,
  assertCanAssignRole,
} from "../../src/modules/rbac/rank.js";
import { getPermissionsForMembership } from "../../src/modules/rbac/get-permissions.js";
import type { Actor } from "../../src/modules/rbac/can.js";
import { one } from "../../src/shared/utils/assert.js";
import { hashPassword } from "../../src/shared/utils/password.js";


type Membership = typeof memberships.$inferSelect;
type Role = typeof roles.$inferSelect;
type School = typeof schools.$inferSelect;

// Hash once — argon2 is slow on purpose. Same password for every test user.
let SEEDED_HASH: string;
beforeAll(async () => {
  SEEDED_HASH = await hashPassword("test-password-1234");
});

describe("rank guards (DB-backed)", () => {
  // Reset state per test. The fixtures below are rebuilt every time.
  let school: School;
  let ownerMembership: Membership;
  let principalMembership: Membership;
  let teacherMembership: Membership;
  let guardianMembership: Membership;
  let secondPrincipalMembership: Membership;
  let otherSchoolMembership: Membership;
  let ownerRole: Role;
  let principalRole: Role;
  let teacherRole: Role;
  let principalActor: Actor;

  beforeEach(async () => {
    // Wipe everything. TRUNCATE users, schools CASCADE reaches every table.
    await db.execute(sql`TRUNCATE TABLE users, schools CASCADE`);

    // Seed the demo school: owner, principal, teacher, guardian, student
    const result = await seed({ password: "test-password-1234" });
    school = result.school;

    // Load the base demo users by email
    const owner = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'owner@demo.test'`),
    );
    const principal = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'principal@demo.test'`),
    );
    const teacher = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'teacher@demo.test'`),
    );
    const guardian = one(
      await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = 'guardian@demo.test'`),
    );

    // Load their memberships at the seeded school
    ownerMembership = one(
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, owner.id),
            eq(memberships.schoolId, school.id),
          ),
        ),
    );
    principalMembership = one(
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, principal.id),
            eq(memberships.schoolId, school.id),
          ),
        ),
    );
    teacherMembership = one(
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, teacher.id),
            eq(memberships.schoolId, school.id),
          ),
        ),
    );
    guardianMembership = one(
      await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, guardian.id),
            eq(memberships.schoolId, school.id),
          ),
        ),
    );

    // Load the seeded roles
    ownerRole = one(
      await db
        .select()
        .from(roles)
        .where(and(eq(roles.schoolId, school.id), eq(roles.key, "owner"))),
    );
    principalRole = one(
      await db
        .select()
        .from(roles)
        .where(and(eq(roles.schoolId, school.id), eq(roles.key, "principal"))),
    );
    teacherRole = one(
      await db
        .select()
        .from(roles)
        .where(and(eq(roles.schoolId, school.id), eq(roles.key, "teacher"))),
    );

    // ── Extra fixture 1: second principal at the SAME school ──
    // Needed to test "principal acting on another principal" (peer-of-peer).
    const secondPrincipalUser = one(
      await db
        .insert(users)
        .values({
          email: `principal2-${crypto.randomUUID()}@demo.test`,
          passwordHash: SEEDED_HASH,
          firstName: "Second",
          lastName: "Principal",
          mustChangePassword: false,
        })
        .returning(),
    );
    secondPrincipalMembership = one(
      await db
        .insert(memberships)
        .values({
          userId: secondPrincipalUser.id,
          schoolId: school.id,
          status: "active",
        })
        .returning(),
    );
    await db.insert(membershipRoles).values({
      membershipId: secondPrincipalMembership.id,
      roleId: principalRole.id,
      schoolId: school.id,
    });

    // ── Extra fixture 2: a completely separate school ──
    // Needed to test that a cross-school ID returns 404 (not 403).
    const otherOwner = one(
      await db
        .insert(users)
        .values({
          email: `other-owner-${crypto.randomUUID()}@demo.test`,
          passwordHash: SEEDED_HASH,
          firstName: "Other",
          lastName: "Owner",
          mustChangePassword: false,
        })
        .returning(),
    );
    const otherResult = await createSchoolWithDefaults(
      {
        name: "Other School",
        slug: `other-${crypto.randomUUID()}`,
        ownerUserId: otherOwner.id,
      },
      { via: "test" },
    );
    otherSchoolMembership = otherResult.ownerMembership;

    // ── Principal actor — derived from the real role, nothing hardcoded ──
    const principalPerms = await getPermissionsForMembership(
      db,
      principalMembership.id,
    );
    principalActor = {
      userId: principal.id,
      membershipId: principalMembership.id,
      schoolId: school.id,
      rank: principalRole.rank, // 80 in today's defaults — but tracked, not typed
      permissions: principalPerms,
    };
  });

  // ── loadMembershipRank ─────────────────────────────────────────────

  it("returns the higher rank when a member has two roles", async () => {
    // Give guardian the principal role too. Guardian rank 25, principal rank 80.
    // loadMembershipRank takes MAX → 80.
    await db.insert(membershipRoles).values({
      membershipId: guardianMembership.id,
      roleId: principalRole.id,
      schoolId: school.id,
    });

    const rank = await loadMembershipRank(db, guardianMembership.id);
    expect(rank).toBe(principalRole.rank);
  });

  it("returns 0 when a member has no roles", async () => {
    const noRoleUser = one(
      await db
        .insert(users)
        .values({
          email: `no-role-${crypto.randomUUID()}@demo.test`,
          firstName: "No",
          lastName: "Role",
        })
        .returning(),
    );
    const noRoleMembership = one(
      await db
        .insert(memberships)
        .values({
          userId: noRoleUser.id,
          schoolId: school.id,
          status: "active",
        })
        .returning(),
    );

    const rank = await loadMembershipRank(db, noRoleMembership.id);
    expect(rank).toBe(0);
  });


  it("principal acting on teacher passes (strictly lower rank)", async () => {
    await expect(
      assertCanActOnUser(db, principalActor, teacherMembership.id),
    ).resolves.not.toThrow();
  });

  it("principal acting on owner throws 403", async () => {
    await expect(
      assertCanActOnUser(db, principalActor, ownerMembership.id),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("principal acting on another principal throws 403 (strictly above)", async () => {
    await expect(
      assertCanActOnUser(db, principalActor, secondPrincipalMembership.id),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("cross-school target throws 404 (no id-probing)", async () => {
    await expect(
      assertCanActOnUser(db, principalActor, otherSchoolMembership.id),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("random UUID throws 404", async () => {
    await expect(
      assertCanActOnUser(db, principalActor, crypto.randomUUID()),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });

  // ── assertCanAssignRole ───────────────────────────────────────────

  it("principal assigning owner role throws 403", async () => {
    await expect(
      assertCanAssignRole(db, principalActor, ownerRole.id),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("principal assigning teacher role passes", async () => {
    await expect(
      assertCanAssignRole(db, principalActor, teacherRole.id),
    ).resolves.not.toThrow();
  });
});
