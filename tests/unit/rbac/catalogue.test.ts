// tests/unit/rbac/catalogue.test.ts
//
// Pure-data invariants on the RBAC catalogue. No DB, no HTTP, no setup.
//
// These tests catch "the catalogue itself is wrong" — bugs that integration
// tests can't, because those only verify "the insert succeeded," not "the
// insert was correct." If DEFAULT_ROLES grants a permission the PRD doesn't
// allow, that's invisible to the DB tests. It's not invisible here.

import { describe, it, expect } from "vitest";
import { PERMISSIONS } from "../../../src/modules/rbac/permissions.js";
import { DEFAULT_ROLES } from "../../../src/modules/rbac/default-roles.js";
import type { RoleKey } from "../../../src/modules/rbac/default-roles.js";

describe("RBAC catalogue invariants", () => {
  it("every permission in the catalogue is granted to at least one default role", () => {
    const allGranted = new Set<string>();
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) {
        allGranted.add(p);
      }
    }

    for (const p of PERMISSIONS) {
      expect(
        allGranted.has(p),
        `Permission '${p}' is in PERMISSIONS but not granted to any role. ` +
          `Route guards using it will always 403 — including for owner.`,
      ).toBe(true);
    }
  });

  it("owner (the catch-all role) has every permission", () => {
    // Stronger than the union test above: catches the case where a permission
    // is granted to some non-owner role but missing from owner specifically.
    const owner = DEFAULT_ROLES.find((r) => r.key === "owner");
    expect(owner, "DEFAULT_ROLES has no 'owner' role").toBeDefined();

    const ownerPerms = new Set<string>(owner!.permissions);
    const catalogue = new Set<string>(PERMISSIONS);

    expect(ownerPerms).toEqual(catalogue);
  });

  it("no role grants a permission that isn't in the catalogue", () => {
    // Defence-in-depth: TypeScript already enforces this via `readonly Permission[]`.
    // But if someone ever writes `as Permission` or bypasses the type, this catches it.
    const catalogue = new Set<string>(PERMISSIONS);
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) {
        expect(
          catalogue.has(p),
          `Role '${role.key}' grants '${p}' which is not in PERMISSIONS. ` +
            `Likely a typo — TypeScript should have caught this, check for casts.`,
        ).toBe(true);
      }
    }
  });

  it("all default role ranks are unique", () => {
    const ranks = DEFAULT_ROLES.map((r) => r.rank);
    const uniqueRanks = new Set(ranks);

    expect(
      uniqueRanks.size,
      `Two roles share a rank: ${ranks.join(", ")}. ` +
        `If this is deliberate (e.g. co-principals), remove this test ` +
        `and document the exception. Otherwise, a role was copy-pasted ` +
        `and the rank wasn't updated.`,
    ).toBe(ranks.length);
  });

  it("lower-rank roles' permission sets are a subset of every higher-rank role's", () => {
    // If role A has a lower rank than role B, A.permissions ⊆ B.permissions.
    // Means: "higher rank implies at least as much power."
    // If this fails, either the rank is wrong or a permission was granted to
    // a lower role that should have been higher — both worth fixing.
    const STAFF_CHAIN: RoleKey[] = ["owner", "principal", "teacher"];

    const staff = DEFAULT_ROLES.filter((r) =>
      STAFF_CHAIN.includes(r.key as RoleKey),
    );
    const sorted = [...staff].sort((a, b) => a.rank - b.rank);

    for (let i = 0; i < sorted.length; i++) {
      const lower = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j++) {
        const higher = sorted[j]!;
        const higherPerms = new Set<string>(higher.permissions);

        for (const p of lower.permissions) {
          expect(
            higherPerms.has(p),
            `Role '${lower.key}' (rank ${lower.rank}) grants '${p}' ` +
              `but higher-rank role '${higher.key}' (rank ${higher.rank}) does not. ` +
              `Either raise '${lower.key}'s rank, remove '${p}' from it, ` +
              `or add '${p}' to '${higher.key}'.`,
          ).toBe(true);
        }
      }
    }
  });
});
