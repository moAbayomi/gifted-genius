// tests/unit/rbac/can.test.ts
import { describe, it, expect } from "vitest";
import {
  can,
  canManageMember,
  canAssignRole,
  type Actor,
  type AssignableRole,
} from "../../../src/modules/rbac/can.js";
import {
  DEFAULT_ROLES,
  type RoleKey,
} from "../../../src/modules/rbac/default-roles.js";
import type { Permission } from "../../../src/modules/rbac/permissions.js";

// ── Fixtures derived from DEFAULT_ROLES (never hardcoded) ─────────────

function roleOf(key: RoleKey) {
  const role = DEFAULT_ROLES.find((r) => r.key === key);
  if (!role) throw new Error(`Test fixture: no default role '${key}'`);
  return role;
}

function defaultPerms(key: RoleKey): Permission[] {
  return [...roleOf(key).permissions];
}

function actorWithRole(key: RoleKey, overrides: Partial<Actor> = {}): Actor {
  const role = roleOf(key);
  return {
    userId: "u1",
    membershipId: "m1",
    schoolId: "s1",
    rank: role.rank,
    permissions: new Set(role.permissions),
    ...overrides,
  };
}

function assignableRole(key: RoleKey): AssignableRole {
  const role = roleOf(key);
  return { rank: role.rank, permissions: [...role.permissions] };
}

// A permission owner has but principal doesn't. Derived at module load —
// so if the defaults change, this tracks. If owner and principal ever have
// identical permissions (design change), the module fails loudly instead
// of silently skipping a test.
const OWNER_PERMS = new Set(defaultPerms("owner"));
const PRINCIPAL_PERMS = new Set(defaultPerms("principal"));
const OWNER_ONLY_PERM = [...OWNER_PERMS].find((p) => !PRINCIPAL_PERMS.has(p));
if (!OWNER_ONLY_PERM) {
  throw new Error(
    "Test setup broken: owner has no permissions principal lacks. " +
      "The 'assign role with a permission principal lacks' test cannot " +
      "be meaningful. Fix DEFAULT_ROLES or the test.",
  );
}

// ── can() ─────────────────────────────────────────────────────────────

describe("can", () => {
  it("denies everything when the actor has no permissions", () => {
    const a: Actor = {
      userId: "u1",
      membershipId: "m1",
      schoolId: "s1",
      rank: 0,
      permissions: new Set(),
    };
    expect(can(a, "school:read")).toBe(false);
    expect(can(a, "users:create")).toBe(false);
    expect(can(a, "audit:read")).toBe(false);
  });

  it("allows a held permission and denies an unheld one", () => {
    const a = actorWithRole("teacher");
    expect(can(a, "school:read")).toBe(true);
    expect(can(a, "users:create")).toBe(false);
  });

  it("denies a resource in another school even with the permission", () => {
    const a = actorWithRole("principal");
    expect(can(a, "users:reset_password", { schoolId: "s2" })).toBe(false);
  });

  it("allows a resource in the same school with the permission", () => {
    const a = actorWithRole("principal", { schoolId: "s1" });
    expect(can(a, "users:reset_password", { schoolId: "s1" })).toBe(true);
  });

  it("when no resource is given, only the permission matters", () => {
    const a = actorWithRole("teacher");
    expect(can(a, "school:read")).toBe(true);
    expect(can(a, "school:read", {})).toBe(true);
  });
});

// ── canManageMember() ─────────────────────────────────────────────────

describe("canManageMember", () => {
  it("owner can manage principal", () => {
    const owner = actorWithRole("owner");
    expect(canManageMember(owner, roleOf("principal").rank)).toBe(true);
  });

  it("principal cannot manage owner", () => {
    const principal = actorWithRole("principal");
    expect(canManageMember(principal, roleOf("owner").rank)).toBe(false);
  });

  it("principal cannot manage another principal (strictly above)", () => {
    const principal = actorWithRole("principal");
    expect(canManageMember(principal, roleOf("principal").rank)).toBe(false);
  });

  it("principal can manage teacher", () => {
    const principal = actorWithRole("principal");
    expect(canManageMember(principal, roleOf("teacher").rank)).toBe(true);
  });

  it("rank-0 actor cannot manage anyone", () => {
    const noRoles: Actor = {
      userId: "u1",
      membershipId: "m1",
      schoolId: "s1",
      rank: 0,
      permissions: new Set(),
    };
    expect(canManageMember(noRoles, 0)).toBe(false);
    expect(canManageMember(noRoles, roleOf("teacher").rank)).toBe(false);
    expect(canManageMember(noRoles, roleOf("owner").rank)).toBe(false);
  });
});

// ── canAssignRole() ───────────────────────────────────────────────────

describe("canAssignRole", () => {
  it("principal cannot assign the owner role", () => {
    const principal = actorWithRole("principal");
    expect(canAssignRole(principal, assignableRole("owner"))).toBe(false);
  });

  it("principal cannot assign a role at the principal's own rank (boundary)", () => {
    const principal = actorWithRole("principal");
    // Hypothetical role at principal's rank, permissions principal holds.
    // If the code used `>` instead of `>=`, this would pass — off-by-one guard.
    const peerRole: AssignableRole = {
      rank: principal.rank,
      permissions: defaultPerms("teacher"),
    };
    expect(canAssignRole(principal, peerRole)).toBe(false);
  });

  it("principal cannot assign a role holding a permission principal lacks", () => {
    const principal = actorWithRole("principal");
    const roleWithForeignPerm: AssignableRole = {
      rank: roleOf("teacher").rank,
      permissions: ["school:read", OWNER_ONLY_PERM],
    };
    expect(canAssignRole(principal, roleWithForeignPerm)).toBe(false);
  });

  it("principal can assign a plain teacher role", () => {
    const principal = actorWithRole("principal");
    expect(canAssignRole(principal, assignableRole("teacher"))).toBe(true);
  });

  it("a role with no permissions below your rank is allowed", () => {
    const principal = actorWithRole("principal");
    const emptyRole: AssignableRole = {
      rank: roleOf("teacher").rank,
      permissions: [],
    };
    expect(canAssignRole(principal, emptyRole)).toBe(true);
  });
});
