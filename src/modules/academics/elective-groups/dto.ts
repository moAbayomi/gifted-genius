import type { ElectiveGroup } from "../../../db/schema/elective-groups.js";

export function toElectiveGroupDto(g: ElectiveGroup) {
  return {
    id: g.id,
    classId: g.classId,
    sessionId: g.sessionId,
    name: g.name,
    minChoices: g.minChoices,
    maxChoices: g.maxChoices,
    archivedAt: g.archivedAt?.toISOString() ?? null,
  };
}

export type ElectiveGroupDto = ReturnType<typeof toElectiveGroupDto>;