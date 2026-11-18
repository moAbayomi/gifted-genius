// tests/unit/academics/selection.test.ts
import { describe, it, expect } from "vitest";
import {
  computeSelection,
  type ElectiveGroup,
  type ElectiveOffering,
  type ProblemCode,
} from "../../../../src/modules/academics/enrollment/selection.js";

// ── Builders ──────────────────────────────────────────────────────────
const g = (
  id: string,
  name: string,
  min: number,
  max: number,
): ElectiveGroup => ({
  id,
  name,
  minChoices: min,
  maxChoices: max,
});
const o = (id: string, groupId: string | null): ElectiveOffering => ({
  id,
  groupId,
});

// ── Fixtures ──────────────────────────────────────────────────────────
// Case 1: two separate 1-1 groups (CRS alone, IRS alone)
const CRS_GRP = g("crs-grp", "CRS", 1, 1);
const IRS_GRP = g("irs-grp", "IRS", 1, 1);
const CRS_IN_CRS_GRP = o("crs", "crs-grp");
const IRS_IN_IRS_GRP = o("irs", "irs-grp");

// Case 2: group (1-2) of four grouped offerings + one ungrouped offering
const ARTS_GRP = g("arts", "Arts", 1, 2);
const ART1 = o("art1", "arts");
const ART2 = o("art2", "arts");
const ART3 = o("art3", "arts");
const ART4 = o("art4", "arts");
const MUSIC_IN_ARTS = o("music", null); // ungrouped — must not count toward `arts`

// Case 3: religion (1-1) + trade (1-2), together
const RELIGION_GRP = g("religion", "Religion", 1, 1);
const TRADE_GRP = g("trade", "Trade", 1, 2);
const CRS_IN_REL = o("crs", "religion");
const IRS_IN_REL = o("irs", "religion");
const TRADE1 = o("trade1", "trade");
const TRADE2 = o("trade2", "trade");
const TRADE3 = o("trade3", "trade");

// Case 4: ungrouped electives
const MUSIC_U = o("music", null);
const PE_U = o("pe", null);

// Case 6c: optional group (0-1)
const OPT_GRP = g("opt", "Optional", 0, 1);
const OPT_A = o("opt-a", "opt");

// ── Case table ────────────────────────────────────────────────────────
interface TestCase {
  name: string;
  groups: ElectiveGroup[];
  offerings: ElectiveOffering[];
  chosen: string[];
  expected: {
    canSave: boolean;
    complete: boolean;
    problems: {
      code: ProblemCode;
      severity: "blocking" | "incomplete";
      groupId: string | null;
    }[];
    groupCounts?: {
      groupId: string;
      count: number;
      status: "ok" | "too_few" | "too_many";
    }[];
  };
}

const CASES: TestCase[] = [
  // ══════════════════════════════════════════════════════════════════════
  // Case 1 — CRS and IRS, each 1-1
  // ══════════════════════════════════════════════════════════════════════
  {
    name: "1a: CRS only → IRS group TOO_FEW",
    groups: [CRS_GRP, IRS_GRP],
    offerings: [CRS_IN_CRS_GRP, IRS_IN_IRS_GRP],
    chosen: ["crs"],
    expected: {
      canSave: true,
      complete: false,
      problems: [
        { code: "TOO_FEW", severity: "incomplete", groupId: "irs-grp" },
      ],
    },
  },
  {
    name: "1b: IRS only → CRS group TOO_FEW",
    groups: [CRS_GRP, IRS_GRP],
    offerings: [CRS_IN_CRS_GRP, IRS_IN_IRS_GRP],
    chosen: ["irs"],
    expected: {
      canSave: true,
      complete: false,
      problems: [
        { code: "TOO_FEW", severity: "incomplete", groupId: "crs-grp" },
      ],
    },
  },
  {
    name: "1c: both → complete",
    groups: [CRS_GRP, IRS_GRP],
    offerings: [CRS_IN_CRS_GRP, IRS_IN_IRS_GRP],
    chosen: ["crs", "irs"],
    expected: { canSave: true, complete: true, problems: [] },
  },
  {
    name: "1d: none → two TOO_FEWs",
    groups: [CRS_GRP, IRS_GRP],
    offerings: [CRS_IN_CRS_GRP, IRS_IN_IRS_GRP],
    chosen: [],
    expected: {
      canSave: true,
      complete: false,
      problems: [
        { code: "TOO_FEW", severity: "incomplete", groupId: "crs-grp" },
        { code: "TOO_FEW", severity: "incomplete", groupId: "irs-grp" },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════
  // Case 2 — group of five (1-2), one ungrouped in the five
  // ══════════════════════════════════════════════════════════════════════
  {
    name: "2a: group (1-2), 0 chosen → TOO_FEW",
    groups: [ARTS_GRP],
    offerings: [ART1, ART2, ART3, ART4, MUSIC_IN_ARTS],
    chosen: [],
    expected: {
      canSave: true,
      complete: false,
      problems: [{ code: "TOO_FEW", severity: "incomplete", groupId: "arts" }],
    },
  },
  {
    name: "2b: group (1-2), 1 chosen → complete",
    groups: [ARTS_GRP],
    offerings: [ART1, ART2, ART3, ART4, MUSIC_IN_ARTS],
    chosen: ["art1"],
    expected: { canSave: true, complete: true, problems: [] },
  },
  {
    name: "2c: group (1-2), 2 chosen → complete",
    groups: [ARTS_GRP],
    offerings: [ART1, ART2, ART3, ART4, MUSIC_IN_ARTS],
    chosen: ["art1", "art2"],
    expected: { canSave: true, complete: true, problems: [] },
  },
  {
    name: "2d: group (1-2), 3 chosen → TOO_MANY blocking",
    groups: [ARTS_GRP],
    offerings: [ART1, ART2, ART3, ART4, MUSIC_IN_ARTS],
    chosen: ["art1", "art2", "art3"],
    expected: {
      canSave: false,
      complete: false,
      problems: [{ code: "TOO_MANY", severity: "blocking", groupId: "arts" }],
    },
  },
  {
    name: "2e: ungrouped offering does not count toward the group",
    groups: [ARTS_GRP],
    offerings: [ART1, ART2, ART3, ART4, MUSIC_IN_ARTS],
    chosen: ["art1", "music"], // 1 grouped + 1 ungrouped → arts count stays 1
    expected: { canSave: true, complete: true, problems: [] },
  },

  // ══════════════════════════════════════════════════════════════════════
  // Case 3 — two groups together (religion 1-1 + trade 1-2)
  // ══════════════════════════════════════════════════════════════════════
  {
    name: "3a: one from each → complete",
    groups: [RELIGION_GRP, TRADE_GRP],
    offerings: [CRS_IN_REL, IRS_IN_REL, TRADE1, TRADE2, TRADE3],
    chosen: ["crs", "trade1"],
    expected: {
      canSave: true,
      complete: true,
      problems: [],
      groupCounts: [
        { groupId: "religion", count: 1, status: "ok" },
        { groupId: "trade", count: 1, status: "ok" },
      ],
    },
  },
  {
    name: "3b: religion 0, trade 1 → religion TOO_FEW, saveable",
    groups: [RELIGION_GRP, TRADE_GRP],
    offerings: [CRS_IN_REL, IRS_IN_REL, TRADE1, TRADE2, TRADE3],
    chosen: ["trade1"],
    expected: {
      canSave: true,
      complete: false,
      problems: [
        { code: "TOO_FEW", severity: "incomplete", groupId: "religion" },
      ],
      groupCounts: [
        { groupId: "religion", count: 0, status: "too_few" },
        { groupId: "trade", count: 1, status: "ok" },
      ],
    },
  },
  {
    name: "3c: religion 1, trade 3 → trade TOO_MANY blocking",
    groups: [RELIGION_GRP, TRADE_GRP],
    offerings: [CRS_IN_REL, IRS_IN_REL, TRADE1, TRADE2, TRADE3],
    chosen: ["crs", "trade1", "trade2", "trade3"],
    expected: {
      canSave: false,
      complete: false,
      problems: [{ code: "TOO_MANY", severity: "blocking", groupId: "trade" }],
      groupCounts: [
        { groupId: "religion", count: 1, status: "ok" },
        { groupId: "trade", count: 3, status: "too_many" },
      ],
    },
  },
  {
    name: "3d: religion 0 + trade 3 → both problems (TOO_FEW + TOO_MANY)",
    groups: [RELIGION_GRP, TRADE_GRP],
    offerings: [CRS_IN_REL, IRS_IN_REL, TRADE1, TRADE2, TRADE3],
    chosen: ["trade1", "trade2", "trade3"],
    expected: {
      canSave: false,
      complete: false,
      problems: [
        { code: "TOO_FEW", severity: "incomplete", groupId: "religion" },
        { code: "TOO_MANY", severity: "blocking", groupId: "trade" },
      ],
      groupCounts: [
        { groupId: "religion", count: 0, status: "too_few" },
        { groupId: "trade", count: 3, status: "too_many" },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════
  // Case 4 — ungrouped electives
  // ══════════════════════════════════════════════════════════════════════
  {
    name: "4a: no groups, two ungrouped chosen → complete",
    groups: [],
    offerings: [MUSIC_U, PE_U],
    chosen: ["music", "pe"],
    expected: { canSave: true, complete: true, problems: [] },
  },
  {
    name: "4b: one group min 1, only ungrouped chosen → TOO_FEW, saveable",
    groups: [RELIGION_GRP],
    offerings: [CRS_IN_REL, IRS_IN_REL, MUSIC_U, PE_U],
    chosen: ["music", "pe"],
    expected: {
      canSave: true,
      complete: false,
      problems: [
        { code: "TOO_FEW", severity: "incomplete", groupId: "religion" },
      ],
    },
  },
  {
    name: "4c: group satisfied + ungrouped chosen → complete",
    groups: [RELIGION_GRP],
    offerings: [CRS_IN_REL, IRS_IN_REL, MUSIC_U, PE_U],
    chosen: ["crs", "music"],
    expected: { canSave: true, complete: true, problems: [] },
  },

  // ══════════════════════════════════════════════════════════════════════
  // Case 5 — class with no electives
  // ══════════════════════════════════════════════════════════════════════
  {
    name: "5a: no electives at all → complete",
    groups: [],
    offerings: [],
    chosen: [],
    expected: { canSave: true, complete: true, problems: [] },
  },
  {
    name: "5b: no electives but an unknown ID was chosen → UNKNOWN_OFFERING",
    groups: [],
    offerings: [],
    chosen: ["ghost"],
    expected: {
      canSave: false,
      complete: false,
      problems: [
        { code: "UNKNOWN_OFFERING", severity: "blocking", groupId: null },
      ],
    },
  },

  // ══════════════════════════════════════════════════════════════════════
  // Case 6 — defensive cases
  // ══════════════════════════════════════════════════════════════════════
  {
    name: "6a: duplicate offering → DUPLICATE_CHOICE blocking",
    // Use 1-2 group so duplicate alone triggers DUPLICATE_CHOICE, not TOO_MANY.
    // (The 1-1 + duplicate case is 6d, which requires dedupe-before-count.)
    groups: [g("grp", "G", 1, 2)],
    offerings: [o("x", "grp"), o("y", "grp")],
    chosen: ["x", "x"],
    expected: {
      canSave: false,
      complete: false,
      problems: [
        { code: "DUPLICATE_CHOICE", severity: "blocking", groupId: null },
      ],
    },
  },
  {
    name: "6b: chosen offering references unknown group → UNKNOWN_GROUP blocking",
    groups: [], // no groups provided
    offerings: [o("x", "not-a-group")], // offering claims one
    chosen: ["x"],
    expected: {
      canSave: false,
      complete: false,
      problems: [
        { code: "UNKNOWN_GROUP", severity: "blocking", groupId: "not-a-group" },
      ],
    },
  },
  {
    name: "6c: optional group (0-1), zero chosen → complete",
    groups: [OPT_GRP],
    offerings: [OPT_A],
    chosen: [],
    expected: { canSave: true, complete: true, problems: [] },
  },
  {
    name: "6d: group (1-1) + duplicate → blocking, NOT two counts",
    // Dedupe-before-count is required here: count must stay 1 (no TOO_MANY),
    // but the duplicate itself must still fire DUPLICATE_CHOICE.
    groups: [RELIGION_GRP],
    offerings: [CRS_IN_REL, IRS_IN_REL],
    chosen: ["crs", "crs"],
    expected: {
      canSave: false,
      complete: false,
      problems: [
        { code: "DUPLICATE_CHOICE", severity: "blocking", groupId: null },
      ],
      groupCounts: [{ groupId: "religion", count: 1, status: "ok" }],
    },
  },
];

// ── Ordering-insensitive comparison helpers ───────────────────────────
const sortProblems = (
  ps: readonly { code: string; groupId: string | null }[],
) =>
  [...ps].sort((a, b) => {
    const ka = `${a.code}|${a.groupId ?? ""}`;
    const kb = `${b.code}|${b.groupId ?? ""}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

const sortGroups = (gs: readonly { groupId: string }[]) =>
  [...gs].sort((a, b) => a.groupId.localeCompare(b.groupId));

// ── The single case table ─────────────────────────────────────────────
describe("computeSelection (table)", () => {
  it.each(CASES)("$name", ({ groups, offerings, chosen, expected }) => {
    const r = computeSelection({
      groups,
      offerings,
      chosen: chosen.map((id) => ({ offeringId: id })),
    });

    expect(r.canSave).toBe(expected.canSave);
    expect(r.complete).toBe(expected.complete);

    const actualProblems = sortProblems(
      r.problems.map((p) => ({
        code: p.code,
        severity: p.severity,
        groupId: p.groupId,
      })),
    );
    const expectedProblems = sortProblems(expected.problems);
    expect(actualProblems).toEqual(expectedProblems);

    if (expected.groupCounts) {
      const actualGroups = sortGroups(
        r.groups.map((g) => ({
          groupId: g.groupId,
          count: g.count,
          status: g.status,
        })),
      );
      const expectedGroups = sortGroups(expected.groupCounts);
      expect(actualGroups).toEqual(expectedGroups);
    }
  });

  it("does not block on an unselected offering with an unknown group", () => {
    const r = computeSelection({
      groups: [],
      offerings: [o("stale", "missing-group"), o("valid", null)],
      chosen: [{ offeringId: "valid" }],
    });

    expect(r.canSave).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const groups = [g("grp", "G", 1, 2)];
    const offerings = [o("a", "grp"), o("b", "grp")];
    const chosen = [{ offeringId: "a" }];
    const before = JSON.stringify({ groups, offerings, chosen });

    computeSelection({ groups, offerings, chosen });

    expect(JSON.stringify({ groups, offerings, chosen })).toBe(before);
  });
});
