import { and, eq, sql } from "drizzle-orm";
import { db } from "./client.js";
import {
  users,
  schools,
  roles,
  memberships,
  membershipRoles,
  type School,
  type User,
  type Role,
} from "./schema/index.js";
import { createSchoolWithDefaults } from "../modules/schools/service.js";
import { one } from "../shared/utils/assert.js";
import { hashPassword } from "../shared/utils/password.js";
import { recordAudit } from "../shared/audit/record.js";
import type { RoleKey } from "../modules/rbac/default-roles.js";
import type { Tx } from "./types.js";

const DEMO_SLUG = "demo";
const DEMO_OWNER_EMAIL = "owner@demo.test";

type DemoUser = {
  roleKey: RoleKey;
  email?: string;
  username?: string;
  firstName: string;
  lastName: string;
};

const DEMO_USERS: DemoUser[] = [
  { roleKey: "principal", email: "principal@demo.test", firstName: "Demo", lastName: "Principal" },
  { roleKey: "teacher",   email: "teacher@demo.test",   firstName: "Demo", lastName: "Teacher" },
  { roleKey: "guardian",  email: "guardian@demo.test",  firstName: "Demo", lastName: "Guardian" },
  { roleKey: "student",   username: "jss1-2026-001",    firstName: "Demo", lastName: "Student" },
];

export async function seed(opts: { password: string }): Promise<{
  school: School;
  owner: User;
  demoUsers: User[];
}> {
  // Hash ONCE. argon2 is slow by design.
  const passwordHash = await hashPassword(opts.password);

  const owner = await ensureDemoOwner(passwordHash);
  const school = await ensureDemoSchool(owner);

  const demoUsers: User[] = [];
  for (const demo of DEMO_USERS) {
    const user = await ensureDemoUser(school, demo, passwordHash);
    demoUsers.push(user);
    console.log(`✓ ${demo.roleKey}: ${demo.email ?? demo.username}`);
  }

  return { school, owner, demoUsers };
}

// ── Owner ─────────────────────────────────────────────────────────────
async function ensureDemoOwner(passwordHash: string): Promise<User> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        email: DEMO_OWNER_EMAIL,
        passwordHash,
        firstName: "Demo",
        lastName: "Owner",
        mustChangePassword: false,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length > 0) {
      const user = inserted[0]!;
      await recordAudit(tx, {
        schoolId: null,
        actorMembershipId: null,
        action: "user.created",
        targetType: "user",
        targetId: user.id,
        after: {
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          status: user.status,
        },
        metadata: { via: "seed", roleKey: "owner" },
      });
      return user;
    }

    // Existed — backfill password if it was created earlier without one
    let user = one(
      await tx
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${DEMO_OWNER_EMAIL.toLowerCase()}`),
    );
    if (!user.passwordHash) {
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: false })
        .where(eq(users.id, user.id));
      user = one(await tx.select().from(users).where(eq(users.id, user.id)));
    }
    return user;
  });
}

// ── School ────────────────────────────────────────────────────────────
async function ensureDemoSchool(owner: User): Promise<School> {
  const existing = await db.select().from(schools).where(eq(schools.slug, DEMO_SLUG));

  if (existing.length > 0) {
    console.log("✓ Demo school exists — skipping");
    return existing[0]!;
  }

  const result = await createSchoolWithDefaults(
    {
      name: "Demo Grammar School, Osogbo",
      slug: DEMO_SLUG,
      ownerUserId: owner.id,
    },
    { via: "seed" },
  );
  console.log("✓ Created demo school");
  return result.school;
}

// ── One demo user (one transaction) ──────────────────────────────────
async function ensureDemoUser(
  school: School,
  demo: DemoUser,
  passwordHash: string,
): Promise<User> {
  const role = one(
    await db
      .select()
      .from(roles)
      .where(and(eq(roles.schoolId, school.id), eq(roles.key, demo.roleKey))),
  );

  return db.transaction(async (tx) => {
    // ── Email-keyed user (principal / teacher / guardian) ──
    if (demo.email) {
      const inserted = await tx
        .insert(users)
        .values({
          email: demo.email,
          passwordHash,
          firstName: demo.firstName,
          lastName: demo.lastName,
          mustChangePassword: false,
        })
        .onConflictDoNothing()
        .returning();

      let user: User;
      let wasCreated = false;

      if (inserted.length > 0) {
        user = inserted[0]!;
        wasCreated = true;
      } else {
        user = one(
          await tx
            .select()
            .from(users)
            .where(sql`lower(${users.email}) = ${demo.email.toLowerCase()}`),
        );
        if (!user.passwordHash) {
          await tx
            .update(users)
            .set({ passwordHash, mustChangePassword: false })
            .where(eq(users.id, user.id));
          user = one(await tx.select().from(users).where(eq(users.id, user.id)));
        }
      }

      await ensureMembershipAndRole(tx, user, school, role);

      if (wasCreated) {
        await recordAudit(tx, {
          schoolId: null,
          actorMembershipId: null,
          action: "user.created",
          targetType: "user",
          targetId: user.id,
          after: {
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            status: user.status,
          },
          metadata: { via: "seed", roleKey: demo.roleKey },
        });
      }
      return user;
    }

    // ── Username-keyed user (student, no email) ──
    const existingMembership = await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.schoolId, school.id),
          eq(memberships.username, demo.username!),
        ),
      );

    if (existingMembership.length > 0) {
      return one(
        await tx
          .select()
          .from(users)
          .where(eq(users.id, existingMembership[0]!.userId)),
      );
    }

    const user = one(
      await tx
        .insert(users)
        .values({
          email: null,
          passwordHash,
          firstName: demo.firstName,
          lastName: demo.lastName,
          mustChangePassword: false,
        })
        .returning(),
    );

    await tx.insert(memberships).values({
      userId: user.id,
      schoolId: school.id,
      username: demo.username!,
      status: "active",
    });

    await ensureMembershipAndRole(tx, user, school, role);

    await recordAudit(tx, {
      schoolId: null,
      actorMembershipId: null,
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      after: {
        firstName: user.firstName,
        lastName: user.lastName,
        status: user.status,
      },
      metadata: { via: "seed", roleKey: demo.roleKey, username: demo.username },
    });

    return user;
  });
}

// Shared: ensure membership + role assignment exist
async function ensureMembershipAndRole(tx: Tx, user: User, school: School, role: Role) {
  await tx
    .insert(memberships)
    .values({ userId: user.id, schoolId: school.id, status: "active" })
    .onConflictDoNothing();

  const membership = one(
    await tx
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, user.id),
          eq(memberships.schoolId, school.id),
        ),
      ),
  );

  await tx
    .insert(membershipRoles)
    .values({
      membershipId: membership.id,
      roleId: role.id,
      schoolId: school.id,
    })
    .onConflictDoNothing();
}