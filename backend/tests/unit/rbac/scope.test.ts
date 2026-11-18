import { describe, it, expect } from "vitest";
import { can, scopeFor, type Actor } from "../../../src/modules/rbac/can.js";
import type { Permission } from "../../../src/modules/rbac/permissions.js";

function actor(
  permissions: Permission[],
  scope?: Actor["scope"],
): Actor {
  return {
    userId: "u1",
    membershipId: "m1",
    schoolId: "s1",
    rank: 10,
    permissions: new Set(permissions),
    ...(scope ? { scope } : {}),
  };
}

const scoped = {
  sessionId: "sess1",
  classIds: ["class-enrolled"],
  formTeacherClassIds: ["class-form"],
  offeringIds: ["offering-taught"],
  taughtClassIds: ["class-taught"],
};

describe("scopeFor", () => {
  it("returns all for an _all permission", () => {
    expect(scopeFor(actor(["enrollments:read_all"]), "enrollments:read")).toBe("all");
  });

  it("returns the actor's class set for a scoped permission", () => {
    const result = scopeFor(actor(["enrollments:read"], scoped), "enrollments:read");
    expect(result).not.toBe("all");
    expect([...result].sort()).toEqual([
      "class-enrolled",
      "class-form",
      "class-taught",
    ]);
  });

  it("returns an empty set without the permission", () => {
    const result = scopeFor(actor([], scoped), "enrollments:read");
    expect(result).not.toBe("all");
    expect([...result]).toEqual([]);
  });
});

describe("can with scope", () => {
  it("allows school-wide access with the _all permission", () => {
    const a = actor(["enrollments:read_all"]);
    expect(can(a, "enrollments:read", { classId: "anything" })).toBe(true);
    expect(can(a, "enrollments:read", { classId: "another", schoolId: "s1" })).toBe(true);
  });

  it("allows an enrolled, form-teacher, or taught class and denies another", () => {
    const a = actor(["enrollments:read"], scoped);
    expect(can(a, "enrollments:read", { classId: "class-enrolled" })).toBe(true);
    expect(can(a, "enrollments:read", { classId: "class-form" })).toBe(true);
    expect(can(a, "enrollments:read", { classId: "class-taught" })).toBe(true);
    expect(can(a, "enrollments:read", { classId: "other-class" })).toBe(false);
  });

  it("lets an offering-only teacher read that offering's class roster", () => {
    const a = actor(["enrollments:read"], {
      ...scoped,
      classIds: [],
      formTeacherClassIds: [],
    });
    expect(can(a, "enrollments:read", { classId: "class-taught" })).toBe(true);
    expect(can(a, "enrollments:read", { classId: "unrelated" })).toBe(false);
  });

  it("allows a taught offering and denies another offering", () => {
    const a = actor(["enrollments:read"], scoped);
    expect(can(a, "enrollments:read", { offeringId: "offering-taught" })).toBe(true);
    expect(can(a, "enrollments:read", { offeringId: "other-offering" })).toBe(false);
  });

  it("denies a resource in another school", () => {
    const a = actor(["enrollments:read_all"]);
    expect(can(a, "enrollments:read", { classId: "c", schoolId: "s2" })).toBe(false);
  });

  it("denies without the permission and allows with no resource", () => {
    expect(can(actor([]), "enrollments:read", { classId: "c" })).toBe(false);
    expect(can(actor(["enrollments:read"], scoped), "enrollments:read")).toBe(true);
  });
});
