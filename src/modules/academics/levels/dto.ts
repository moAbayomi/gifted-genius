import type { Level } from "../../../db/schema/levels.js";

export function toLevelDto(level: Level) {
  return {
    id:       level.id,
    name:     level.name,
    sequence: level.sequence,
    stage:    level.stage,
    archivedAt: level.archivedAt?.toISOString() ?? null,
  };
}