import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/client.js";
import { createSchoolWithDefaults } from "../../src/modules/schools/service.js";
import { DEFAULT_ROLES } from "../../src/modules/rbac/default-roles.js";
import { PERMISSIONS } from "../../src/modules/rbac/permissions.js";
import {
  schools,
  roles,
  rolePermissions,
  memberships,
  membershipRoles,
  auditLog,
  users,
} from "../../src/db/schema/index.js";
import { eq, and, count} from "drizzle-orm";
import { one } from "../../src/shared/utils/assert.js";
import {
  isUniqueViolation,
  isForeignKeyViolation,
} from "../../src/shared/errors/pg-errors.js";
import type { Role } from "../../src/db/schema/index.js";

async function counts() {
  const schoolsN = one(await db.select({ value: count() }).from(schools));
  const rolesN = one(await db.select({ value: count() }).from(roles));
  const permsN = one(await db.select({ value: count() }).from(rolePermissions));
  const membersN = one(await db.select({ value: count() }).from(memberships));
  const mRolesN = one(
    await db.select({ value: count() }).from(membershipRoles),
  );
  const auditN = one(await db.select({ value: count() }).from(auditLog));
  return {
    schools: schoolsN.value,
    roles: rolesN.value,
    perms: permsN.value,
    memberships: membersN.value,
    membershipRoles: mRolesN.value,
    audit: auditN.value,
  };
}

describe("createSchoolWithDefaults", () => {
  let ownerUserId: string;

  beforeEach(async () => {
    const owner = one(
      await db
        .insert(users)
        .values({
          email: `owner-${crypto.randomUUID()}@test.com`,
          firstName: "Test",
          lastName: "Owner",
        })
        .returning(),
    );
    ownerUserId = owner.id;
  });

  it("creates a school with all system roles, permissions, owner membership, and audit row", async () => {
    const result = await createSchoolWithDefaults(
      { name: "King's College", slug: "kings-college", ownerUserId },
      { via: "test" },
    );

    // ── Return shape ──
    expect(result.school.name).toBe("King's College");
    expect(result.school.slug).toBe("kings-college");
    expect(result.ownerMembership.userId).toBe(ownerUserId);
    expect(result.ownerMembership.schoolId).toBe(result.school.id);

    // ── Roles ──
    expect(result.roles).toHaveLength(DEFAULT_ROLES.length);
    expect(result.roles.every((r) => r.isSystem)).toBe(true);

    const roleKeys = result.roles.map((r) => r.key).sort();
    expect(roleKeys).toEqual(DEFAULT_ROLES.map((r) => r.key).sort());

    // ── Permissions match the DEFAULT_ROLES catalog ──
    const expectedPermCount = DEFAULT_ROLES.reduce(
      (sum, r) => sum + r.permissions.length,
      0,
    );
    const permCount = one(
      await db.select({ value: count() }).from(rolePermissions),
    );
    expect(permCount.value).toBe(expectedPermCount);

    // ── Owner has permissions ──
    const ownerRole = one(result.roles.filter((r) => r.key === "owner"));
    const ownerPerms = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, ownerRole.id));
    const ownerPermSet = new Set(ownerPerms.map((p) => p.permission));
    const expectedOwnerPerms = new Set(PERMISSIONS);

    expect(ownerPermSet).toEqual(expectedOwnerPerms);
    // ── Membership ──
    const membershipRow = one(
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.id, result.ownerMembership.id)),
    );
    expect(membershipRow.status).toBe("active");

    // ── Owner role assigned to owner membership ──
    const assignment = one(
      await db
        .select()
        .from(membershipRoles)
        .where(
          and(
            eq(membershipRoles.membershipId, result.ownerMembership.id),
            eq(membershipRoles.roleId, ownerRole.id),
          ),
        ),
    );
    expect(assignment.schoolId).toBe(result.school.id);
    expect(assignment.assignedBy).toBeNull();

    // ── Audit row ──
    const audit = one(
      await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.targetId, result.school.id)),
    );
    expect(audit.action).toBe("school.created");
    expect(audit.targetType).toBe("school");
    expect(audit.schoolId).toBe(result.school.id);
    expect(audit.actorMembershipId).toBeNull();
    expect(audit.after).toMatchObject({
      name: "King's College",
      slug: "kings-college",
      type: "combined",
      status: "active",
    });
    expect(audit.metadata).toMatchObject({ via: "test", ownerUserId });
  });

  it("rejects a duplicate slug and leaves nothing from the failed attempt", async () => {
    const first = await createSchoolWithDefaults(
      { name: "King's College", slug: "kings-college", ownerUserId },
      { via: "test" },
    );

    const beforeCounts = await counts();

    await expect(
      createSchoolWithDefaults(
        { name: "Imposter School", slug: "kings-college", ownerUserId },
        { via: "test" },
      ),
    ).rejects.toSatisfy((err) => isUniqueViolation(err, "schools_slug_uq"));

    expect(await counts()).toEqual(beforeCounts);

    const row = one(
      await db.select().from(schools).where(eq(schools.slug, "kings-college")),
    );
    expect(row.id).toBe(first.school.id);
    expect(row.name).toBe("King's College");

    const auditRows = await db.select().from(auditLog);
    expect(auditRows).toHaveLength(1);
  });

  it("produces completely isolated data for two schools", async () => {
    const ownerA = one(
      await db
        .insert(users)
        .values({
          email: `owner-a-${crypto.randomUUID()}@test.com`,
          firstName: "Owner",
          lastName: "A",
        })
        .returning(),
    );
    const ownerB = one(
      await db
        .insert(users)
        .values({
          email: `owner-b-${crypto.randomUUID()}@test.com`,
          firstName: "Owner",
          lastName: "B",
        })
        .returning(),
    );

    const a = await createSchoolWithDefaults(
      { name: "School A", slug: "school-a", ownerUserId: ownerA.id },
      { via: "test" },
    );
    const b = await createSchoolWithDefaults(
      { name: "School B", slug: "school-b", ownerUserId: ownerB.id },
      { via: "test" },
    );

    // Distinct entities
    expect(a.school.id).not.toBe(b.school.id);
    expect(a.ownerMembership.id).not.toBe(b.ownerMembership.id);

    // Role rows don't overlap
    const aRoleIds = new Set(a.roles.map((r) => r.id));
    const bRoleIds = new Set(b.roles.map((r) => r.id));
    for (const id of aRoleIds) expect(bRoleIds.has(id)).toBe(false);

    // Every role scoped to its own school
    for (const r of a.roles) expect(r.schoolId).toBe(a.school.id);
    for (const r of b.roles) expect(r.schoolId).toBe(b.school.id);

    // Memberships point at the right school + user
    expect(a.ownerMembership.schoolId).toBe(a.school.id);
    expect(a.ownerMembership.userId).toBe(ownerA.id);
    expect(b.ownerMembership.schoolId).toBe(b.school.id);
    expect(b.ownerMembership.userId).toBe(ownerB.id);

    // Role assignments scoped correctly
    const aOwnerRole = one(a.roles.filter((r) => r.key === "owner"));
    const bOwnerRole = one(b.roles.filter((r) => r.key === "owner"));

    const aAssignment = one(
      await db
        .select()
        .from(membershipRoles)
        .where(eq(membershipRoles.membershipId, a.ownerMembership.id)),
    );
    expect(aAssignment.roleId).toBe(aOwnerRole.id);
    expect(aAssignment.schoolId).toBe(a.school.id);

    const bAssignment = one(
      await db
        .select()
        .from(membershipRoles)
        .where(eq(membershipRoles.membershipId, b.ownerMembership.id)),
    );
    expect(bAssignment.roleId).toBe(bOwnerRole.id);
    expect(bAssignment.schoolId).toBe(b.school.id);

    // Every permission row belongs to exactly one school's role
    const permRows = await db
      .select({ roleId: rolePermissions.roleId })
      .from(rolePermissions);
    for (const row of permRows) {
      const inA = aRoleIds.has(row.roleId);
      const inB = bRoleIds.has(row.roleId);
      expect(inA !== inB).toBe(true);
    }

    // Audit rows scoped to their schools
    const aAudit = one(
      await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.schoolId, a.school.id)),
    );
    const bAudit = one(
      await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.schoolId, b.school.id)),
    );
    expect(aAudit.metadata).toMatchObject({ ownerUserId: ownerA.id });
    expect(bAudit.metadata).toMatchObject({ ownerUserId: ownerB.id });

    expect(JSON.stringify(aAudit.metadata)).not.toContain(ownerB.id);
    expect(JSON.stringify(bAudit.metadata)).not.toContain(ownerA.id);
  });

  it("rolls back everything when a late step fails", async () => {
    // A user id that doesn't exist. The FK on memberships.user_id will
    // reject this at step 4 — AFTER the school, roles, and permissions
    // have already been inserted. If the transaction is missing, those
    // prior inserts will persist and this test will fail.
    const nonexistentOwnerId = crypto.randomUUID();

    await expect(
      createSchoolWithDefaults(
        {
          name: "Doomed School",
          slug: "doomed-school",
          ownerUserId: nonexistentOwnerId,
        },
        { via: "test" },
      ),
    ).rejects.toThrow(); // FK violation

    // Assert nothing persisted. If any of these is > 0, the transaction
    // is missing or broken.
    const c = await counts();
    expect(c).toEqual({
      schools: 0,
      roles: 0,
      perms: 0,
      memberships: 0,
      membershipRoles: 0,
      audit: 0,
    });
  });

  it("database rejects a role from another school", async () => {
    // Two owners (beforeEach created one; this test needs two).
    const ownerA = one(
      await db
        .insert(users)
        .values({
          email: `owner-a-${crypto.randomUUID()}@test.com`,
          firstName: "Owner",
          lastName: "A",
        })
        .returning(),
    );
    const ownerB = one(
      await db
        .insert(users)
        .values({
          email: `owner-b-${crypto.randomUUID()}@test.com`,
          firstName: "Owner",
          lastName: "B",
        })
        .returning(),
    );

    const a = await createSchoolWithDefaults(
      { name: "A", slug: "a", ownerUserId: ownerA.id },
      { via: "test" },
    );
    const b = await createSchoolWithDefaults(
      { name: "B", slug: "b", ownerUserId: ownerB.id },
      { via: "test" },
    );

    // B's teacher role — belongs to B, not A.
    const roleInB = one(b.roles.filter((r) => r.key === "teacher"));

    // Bypass the service entirely. Insert directly into membership_roles:
    //   membership at A  +  role at B  +  school = A
    // The membership FK passes (A's membership, A's school — consistent).
    // The role FK must fail: (roleInB.id, A.school.id) isn't a valid
    // (id, schoolId) pair in `roles` — roleInB belongs to B, not A.
    await expect(
      db.insert(membershipRoles).values({
        membershipId: a.ownerMembership.id,
        roleId: roleInB.id,
        schoolId: a.school.id,
      }),
    ).rejects.toSatisfy((e) =>
      isForeignKeyViolation(e, "membership_roles_role_school_fk"),
    );

    // Sanity: the attempt left no row behind (Postgres aborts the statement).
    const rows = await db
      .select()
      .from(membershipRoles)
      .where(eq(membershipRoles.membershipId, a.ownerMembership.id));
    expect(rows).toHaveLength(1); // only the owner role assignment from creation
  });
});

describe("composite FK enforcement", () => {
  type ServiceResult = Awaited<ReturnType<typeof createSchoolWithDefaults>>;

  let a: ServiceResult;
  let b: ServiceResult;
  let ownerA: typeof users.$inferSelect;
  let ownerB: typeof users.$inferSelect;
  let roleInA: Role;
  let roleInB: Role;

  beforeEach(async () => {
    ownerA = one(
      await db
        .insert(users)
        .values({
          email: `owner-a-${crypto.randomUUID()}@test.com`,
          firstName: "Owner",
          lastName: "A",
        })
        .returning(),
    );
    ownerB = one(
      await db
        .insert(users)
        .values({
          email: `owner-b-${crypto.randomUUID()}@test.com`,
          firstName: "Owner",
          lastName: "B",
        })
        .returning(),
    );

    a = await createSchoolWithDefaults(
      { name: "A", slug: "a", ownerUserId: ownerA.id },
      { via: "test" },
    );
    b = await createSchoolWithDefaults(
      { name: "B", slug: "b", ownerUserId: ownerB.id },
      { via: "test" },
    );

    roleInA = one(a.roles.filter((r) => r.key === "teacher"));
    roleInB = one(b.roles.filter((r) => r.key === "teacher"));
  });

  it("rejects a role from another school", async () => {
    await expect(
      db.insert(membershipRoles).values({
        membershipId: a.ownerMembership.id,
        roleId: roleInB.id,
        schoolId: a.school.id,
      }),
    ).rejects.toSatisfy((e) =>
      isForeignKeyViolation(e, "membership_roles_role_school_fk"),
    );
  });

  it("rejects a membership from another school", async () => {
    // Role is from B, school is B — so the role FK PASSES.
    // Membership is from A, school is B — so the membership FK FAILS.
    // Isolates the membership FK: only one constraint can be the failure.
    await expect(
      db.insert(membershipRoles).values({
        membershipId: a.ownerMembership.id, // A's member
        roleId: roleInB.id, // B's role (matches B's school)
        schoolId: b.school.id, // B's school
      }),
    ).rejects.toSatisfy((e) =>
      isForeignKeyViolation(e, "membership_roles_membership_school_fk"),
    );
  });

  it("rejects an assignedBy from another school", async () => {
    // Every main column is A's — so membership FK and role FK both PASS.
    // Only the assignedBy FK can fire: B's owner is recorded as having
    // assigned an A-school role, which is impossible.
    await expect(
      db.insert(membershipRoles).values({
        membershipId: a.ownerMembership.id, // A's member
        roleId: roleInA.id, // A's role (not yet assigned, PK ok)
        schoolId: a.school.id, // A's school
        assignedBy: b.ownerMembership.id, // B's member — wrong school
      }),
    ).rejects.toSatisfy((e) =>
      isForeignKeyViolation(e, "membership_roles_assigned_by_school_fk"),
    );
  });

  it("allows a same-school role assignment (control)", async () => {
    // Everything A-scoped. This MUST succeed, or the FKs are broken
    // in the rejecting direction — which none of the three tests above
    // would catch (they'd all still "pass" — they expect rejection).
    await db.insert(membershipRoles).values({
      membershipId: a.ownerMembership.id,
      roleId: roleInA.id,
      schoolId: a.school.id,
      assignedBy: a.ownerMembership.id,
    });

    // Confirm the row landed.
    const rows = await db
      .select()
      .from(membershipRoles)
      .where(
        and(
          eq(membershipRoles.membershipId, a.ownerMembership.id),
          eq(membershipRoles.roleId, roleInA.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
