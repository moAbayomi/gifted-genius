// src/modules/academics/enrollment/selection.ts

// ── Public types ──────────────────────────────────────────────────────
// Pure function contract. No DB, Express, Zod, or can() imports.
// The service adapts rows into these plain inputs.

export interface ElectiveGroup {
  id: string;
  name: string;
  minChoices: number;
  maxChoices: number;
}

export interface ElectiveOffering {
  id: string;              // class_subjects.id
  groupId: string | null;  // null = ungrouped elective
}

export interface ChosenOffering {
  offeringId: string;      // class_subjects.id
}

export type ProblemCode =
  | "TOO_MANY"
  | "TOO_FEW"
  | "UNKNOWN_OFFERING"
  | "DUPLICATE_CHOICE"
  | "UNKNOWN_GROUP";

export interface SelectionProblem {
  code: ProblemCode;
  severity: "blocking" | "incomplete";
  groupId: string | null;
  count?: number;
  min?: number;
  max?: number;
  message: string;
}

export interface GroupSelection {
  groupId: string;
  name: string;
  min: number;
  max: number;
  count: number;
  status: "ok" | "too_few" | "too_many";
}

export interface SelectionResult {
  canSave: boolean;
  complete: boolean;
  problems: SelectionProblem[];
  groups: GroupSelection[];
}

export interface ComputeSelectionInput {
  groups: ElectiveGroup[];
  offerings: ElectiveOffering[];
  chosen: ChosenOffering[];
}

// ── The pure function ─────────────────────────────────────────────────

export function computeSelection(
  input: ComputeSelectionInput,
): SelectionResult {
  const { groups, offerings, chosen } = input;
  const problems: SelectionProblem[] = [];
  const groupSelections: GroupSelection[] = [];

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupOfOffering = new Map<string, string | null>();
  for (const o of offerings) groupOfOffering.set(o.id, o.groupId);

  // 1. Duplicates — same offering chosen twice.
  const seen = new Set<string>();
  for (const c of chosen) {
    if (seen.has(c.offeringId)) {
      problems.push({
        code: "DUPLICATE_CHOICE",
        severity: "blocking",
        groupId: null,
        message: `Offering ${c.offeringId} was chosen more than once`,
      });
    }
    seen.add(c.offeringId);
  }

  // 2. Unknown offerings — chosen ID not in this class's elective offerings.
  //    Catches two caller bugs: a compulsory offering slipped in, or a stale
  //    ID from another class. Loud, not silent.
  const knownOfferingIds = new Set(offerings.map((o) => o.id));
  for (const c of chosen) {
    if (!knownOfferingIds.has(c.offeringId)) {
      problems.push({
        code: "UNKNOWN_OFFERING",
        severity: "blocking",
        groupId: null,
        message: `Offering ${c.offeringId} is not an elective offering for this class`,
      });
    }
  }

  // 3. Unknown groups — a *chosen* elective offering references a group not
  //    in the groups array. Signals inconsistent input (offerings and groups
  //    fetched from different classes). An unselected offering with a stale
  //    group must not block a valid selection. Report once per unknown group.
  const unknownGroups = new Set<string>();
  for (const c of chosen) {
    const groupId = groupOfOffering.get(c.offeringId);
    if (groupId !== undefined && groupId !== null && !groupById.has(groupId)) {
      unknownGroups.add(groupId);
    }
  }
  for (const gid of unknownGroups) {
    problems.push({
      code: "UNKNOWN_GROUP",
      severity: "blocking",
      groupId: gid,
      message: `Elective offerings reference group ${gid}, but that group was not provided`,
    });
  }

  // 4. Count DISTINCT chosen offerings per group.
  //    Dedupe first so that a repeated offering contributes 1 to its group,
  //    not 2. The duplicate itself is already reported as DUPLICATE_CHOICE
  //    (blocking); counting it twice would also spuriously fire TOO_MANY.
  const uniqueChosenIds = new Set(chosen.map((c) => c.offeringId));
  const counts = new Map<string, number>();
  for (const id of uniqueChosenIds) {
    const gid = groupOfOffering.get(id);
    if (gid) counts.set(gid, (counts.get(gid) ?? 0) + 1);
  }  // 5. Validate each group against its min/max, build positive status.
  for (const g of groups) {
    const count = counts.get(g.id) ?? 0;
    let status: GroupSelection["status"];

    if (count > g.maxChoices) {
      status = "too_many";
      problems.push({
        code: "TOO_MANY",
        severity: "blocking",
        groupId: g.id,
        count,
        max: g.maxChoices,
        message: `${g.name}: choose at most ${g.maxChoices}, you chose ${count}`,
      });
    } else if (count < g.minChoices) {
      status = "too_few";
      problems.push({
        code: "TOO_FEW",
        severity: "incomplete",
        groupId: g.id,
        count,
        min: g.minChoices,
        message: `${g.name}: choose at least ${g.minChoices}, you chose ${count}`,
      });
    } else {
      status = "ok";
    }

    groupSelections.push({
      groupId: g.id,
      name: g.name,
      min: g.minChoices,
      max: g.maxChoices,
      count,
      status,
    });
  }

  const canSave = !problems.some((p) => p.severity === "blocking");
  const complete = problems.length === 0;

  return { canSave, complete, problems, groups: groupSelections };
}